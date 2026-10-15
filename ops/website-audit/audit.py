#!/usr/bin/env python3
"""Read-only, stdlib-only website/server checks with durable Discord delivery."""
from __future__ import annotations

import argparse
import calendar
import contextlib
import datetime as dt
import hashlib
import json
import math
import os
from pathlib import Path
import re
import shutil
import signal
import socket
import ssl
import stat
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

UTC = dt.timezone.utc
MAX_OUTPUT = 512 * 1024
MAX_BODY = 128 * 1024
FULL_CATEGORIES = {"audit-prod", "audit-full", "outdated", "lint", "typecheck", "unit", "build", "gitleaks"}
METRIC_KEYS = {"exit_code", "errors", "warnings", "findings", "packages", "info", "low", "moderate", "high", "critical", "total", "vulnerabilities", "tests", "passed", "failed", "skipped", "duration_seconds", "revision", "cache_age_days", "available_packages", "execution_error", "known_dev_advisory", "invalid_report", "install_failed", "dedicated_browser_test_environment_required", "scanner_failed", "potential_secrets", "history_scanned", "container_failed", "credential_required", "query_failed", "truncated"}
WEBHOOK_PATH = re.compile(r"^/api/(?:v\d+/)?webhooks/\d+/[A-Za-z0-9._-]+/?$")
WEBHOOK_RE = re.compile(r"https?://(?:[\w-]+\.)?discord(?:app)?\.com/api/(?:v\d+/)?webhooks/[^\s\"'<>]+", re.I)
ENV_EXPOSURE = re.compile(rb"(?m)^\s*(?:DATABASE_URL|JWT_SECRET|APP_KEY|NEXTAUTH_SECRET|DB_PASSWORD|AWS_SECRET_ACCESS_KEY|[A-Z_]*PRIVATE_KEY|[A-Z_]*API_KEY)\s*=\s*[^\r\n]{6,}")
GIT_EXPOSURE = re.compile(rb"\A(?:ref: refs/(?:heads|tags)/[^\r\n]+|[0-9a-f]{40})\s*\Z")


def utcnow():
    return dt.datetime.now(UTC)


def iso(value):
    return value.astimezone(UTC).isoformat(timespec="seconds")


def parse_time(value):
    return dt.datetime.fromisoformat(value).astimezone(UTC)


def redact(value, secrets=()):
    """Defense in depth; request bodies, process output and log text never enter reports."""
    if isinstance(value, dict):
        return {str(k): redact(v, secrets) for k, v in value.items()}
    if isinstance(value, list):
        return [redact(v, secrets) for v in value]
    if not isinstance(value, str):
        return value
    value = WEBHOOK_RE.sub("[REDACTED_WEBHOOK]", value)
    value = re.sub(r"(?i)\b(?:bearer\s+)[A-Za-z0-9._~+/-]+=*", "Bearer [REDACTED]", value)
    value = re.sub(r"(?i)\b(password|secret|token|api[_-]?key)\s*[=:]\s*[^\s,;]+", r"\1=[REDACTED]", value)
    for secret in secrets:
        if secret:
            value = value.replace(secret, "[REDACTED]")
    return value


def private_dir(path):
    path.mkdir(parents=True, exist_ok=True, mode=0o700)
    if path.is_symlink() or not path.is_dir():
        raise ValueError("Unsafe state directory")
    os.chmod(path, 0o700)


def atomic_json(path, value):
    private_dir(path.parent)
    temp = path.with_name(path.name + "." + uuid.uuid4().hex + ".tmp")
    fd = os.open(temp, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            json.dump(value, handle, ensure_ascii=False, indent=2)
            handle.write("\n")
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temp, path)
        os.chmod(path, 0o600)
    finally:
        with contextlib.suppress(FileNotFoundError):
            temp.unlink()


def read_json(path, default):
    if not path.exists():
        return default
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


class OverlapError(RuntimeError):
    pass


@contextlib.contextmanager
def site_lock(path):
    private_dir(path.parent)
    fd = os.open(path, os.O_RDWR | os.O_CREAT, 0o600)
    os.chmod(path, 0o600)
    locked = False
    try:
        if os.name == "nt":
            import msvcrt
            if os.fstat(fd).st_size == 0:
                os.write(fd, b"0")
            os.lseek(fd, 0, os.SEEK_SET)
            try:
                msvcrt.locking(fd, msvcrt.LK_NBLCK, 1)
            except OSError as exc:
                raise OverlapError("A previous audit is still running") from exc
        else:
            import fcntl
            try:
                fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
            except BlockingIOError as exc:
                raise OverlapError("A previous audit is still running") from exc
        locked = True
        yield
    finally:
        if locked:
            if os.name == "nt":
                import msvcrt
                os.lseek(fd, 0, os.SEEK_SET)
                msvcrt.locking(fd, msvcrt.LK_UNLCK, 1)
            else:
                import fcntl
                fcntl.flock(fd, fcntl.LOCK_UN)
        os.close(fd)


def full_due(config, state, now):
    previous = state.get("last_full_at")
    if not previous:
        return True
    previous = parse_time(previous)
    if config.get("cadence") == "monthly":
        year, month = previous.year + (previous.month == 12), previous.month % 12 + 1
        due = previous.replace(year=year, month=month, day=min(previous.day, calendar.monthrange(year, month)[1]))
    else:
        due = previous + dt.timedelta(days=int(config.get("interval_days", 14)))
    # The daily cron owns the hour; a late manual first run must not postpone day 14 to day 15.
    return now.date() >= due.date()


def result(name, kind, status, message, **metrics):
    return {"name": name, "kind": kind, "status": status, "message": message, "metrics": metrics}


def run_process(argv, timeout=120, cwd=None, output_limit=MAX_OUTPUT, env=None):
    """Drain pipes without retaining unbounded output; kill the whole POSIX process group on timeout."""
    if not isinstance(argv, list) or not argv or not all(isinstance(v, str) and v for v in argv):
        return {"error": "invalid_argv", "returncode": None, "output": b"", "truncated": False}
    try:
        process = subprocess.Popen(argv, cwd=cwd, env=env, stdin=subprocess.DEVNULL,
                                   stdout=subprocess.PIPE, stderr=subprocess.STDOUT, shell=False,
                                   start_new_session=os.name != "nt")
    except (OSError, ValueError):
        return {"error": "process_start_failed", "returncode": None, "output": b"", "truncated": False}
    chunks, retained = [], 0
    truncated = False

    def drain():
        nonlocal retained, truncated
        while True:
            chunk = process.stdout.read(8192)
            if not chunk:
                break
            room = max(0, output_limit - retained)
            if room:
                chunks.append(chunk[:room])
                retained += min(room, len(chunk))
            if len(chunk) > room:
                truncated = True

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    error = None
    try:
        process.wait(timeout=max(0.05, min(float(timeout), 7200)))
    except subprocess.TimeoutExpired:
        error = "timeout"
        if os.name == "nt":
            process.kill()
        else:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
        process.wait()
    reader.join(timeout=2)
    if reader.is_alive():
        error = error or "output_pipe_not_closed"
        if os.name != "nt":
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
            reader.join(timeout=2)
    else:
        process.stdout.close()
    return {"error": error, "returncode": process.returncode, "output": b"".join(chunks), "truncated": truncated}


def command_result(command, env=None):
    name = command["name"]
    process = run_process(command["argv"], command.get("timeout", 120), command.get("cwd"), env=env)
    if process["error"]:
        return result(name, "repository", "error", process["error"])
    code = process["returncode"]
    if process["truncated"]:
        return result(name, "repository", "error", "Output exceeded the bounded parser limit", exit_code=code)
    parser = command.get("parser", "generic")
    if parser == "generic":
        return result(name, "repository", "pass" if code == 0 else "fail", "Command completed" if code == 0 else "Command failed; inspect the isolated check locally", exit_code=code)
    try:
        payload = json.loads(process["output"])
    except (ValueError, UnicodeError):
        # Gitleaks exit status is authoritative even when no JSON findings are emitted.
        if parser == "gitleaks" and code in (0, 1):
            return result(name, "repository", "pass" if code == 0 else "fail", "Secret scanner completed; findings withheld", exit_code=code)
        return result(name, "repository", "error", "Expected structured output was unavailable", exit_code=code)
    if parser == "check-bundle":
        return bundle_results(name, payload, code)
    if code not in (0, 1):
        return result(name, "repository", "error", "Tool failed before completing its audit", exit_code=code)
    if parser == "npm-audit":
        counts = payload.get("metadata", {}).get("vulnerabilities") if isinstance(payload, dict) else None
        if not isinstance(counts, dict) or not all(isinstance(counts.get(k), int) and counts[k] >= 0 for k in ("info", "low", "moderate", "high", "critical")):
            return result(name, "repository", "error", "Dependency audit coverage unavailable", exit_code=code)
        counts = {k: counts[k] for k in ("info", "low", "moderate", "high", "critical")}
        count = sum(counts.values())
        if code and not count:
            return result(name, "repository", "error", "Dependency audit exited unsuccessfully without vulnerability counts", exit_code=code)
        return result(name, "repository", "fail" if counts["high"] + counts["critical"] else "warn" if count else "pass", "Dependency vulnerability counts", vulnerabilities=counts)
    if parser == "npm-outdated" and isinstance(payload, dict):
        if code and not payload:
            return result(name, "repository", "error", "Outdated lookup exited unsuccessfully without package results", exit_code=code)
        return result(name, "repository", "warn" if payload else "pass", "Available package updates; no updates performed", packages=len(payload))
    if parser == "eslint" and isinstance(payload, list) and all(isinstance(item, dict) and isinstance(item.get("errorCount"), int) and isinstance(item.get("warningCount"), int) for item in payload):
        errors = sum(item["errorCount"] for item in payload)
        warnings = sum(item["warningCount"] for item in payload)
        if code and not errors and not warnings:
            return result(name, "repository", "error", "Lint exited unsuccessfully without diagnostic counts", exit_code=code)
        return result(name, "repository", "fail" if errors else "warn" if warnings else "pass", "Lint diagnostic counts", errors=errors, warnings=warnings)
    if parser == "gitleaks" and (isinstance(payload, list) or isinstance(payload, dict) and isinstance(payload.get("findings"), int)):
        findings = len(payload) if isinstance(payload, list) else payload["findings"]
        return result(name, "repository", "fail" if findings or code else "pass", "Secret scanner completed; findings withheld", findings=findings)
    return result(name, "repository", "error", "Structured check output did not match its parser", exit_code=code)


def safe_metrics(value, depth=0):
    if not isinstance(value, dict) or depth > 2:
        raise ValueError("Invalid metrics")
    cleaned = {}
    for key, item in value.items():
        if key not in METRIC_KEYS:
            continue
        if isinstance(item, (int, bool)) or isinstance(item, float) and math.isfinite(item):
            cleaned[key] = item
        elif isinstance(item, dict):
            cleaned[key] = safe_metrics(item, depth + 1)
        elif key == "revision" and isinstance(item, str) and re.fullmatch(r"[a-f0-9]{7,64}", item):
            cleaned[key] = item
        else:
            raise ValueError("Invalid metric value")
    return cleaned


def bundle_results(name, payload, code):
    """Only validated categories, statuses and numeric allowlisted metrics cross the wrapper boundary."""
    try:
        if code not in (0, 1, 2) or not isinstance(payload, dict) or not isinstance(payload.get("checks"), list) or not payload["checks"]:
            raise ValueError("Invalid bundle")
        checks, seen_names = [], set()
        for item in payload["checks"]:
            if not isinstance(item, dict) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9 _./()&-]{0,119}", item.get("name", "")) or item["name"] in seen_names:
                raise ValueError("Invalid check name")
            category = item.get("category")
            if category not in FULL_CATEGORIES | {"setup", "install", "schema", "logs"} or item.get("status") not in ("pass", "warn", "fail", "blocked"):
                raise ValueError("Invalid check category/status")
            seen_names.add(item["name"])
            status = "error" if item["status"] == "blocked" else item["status"]
            kind = "runtime-logs" if category == "logs" else "repository"
            check = result(name + "/" + item["name"], kind, status, "Isolated check " + item["status"], **safe_metrics(item.get("metrics", {})))
            check["category"] = category
            checks.append(check)
        revision = payload.get("revision")
        if revision is not None:
            if not isinstance(revision, str) or not re.fullmatch(r"[a-f0-9]{7,64}", revision):
                raise ValueError("Invalid revision hash")
            checks[0]["metrics"]["revision"] = revision
        if (code == 1 and not any(check["status"] in ("fail", "error") for check in checks)
                or code == 2 and all(check["status"] == "pass" for check in checks)):
            raise ValueError("Exit status contradicts check results")
        return checks
    except (ValueError, TypeError):
        return [result(name, "repository", "error", "Repository bundle was invalid or incomplete", exit_code=code)]


def endpoint(url):
    parsed = urllib.parse.urlsplit(url)
    if parsed.scheme not in ("https", "http") or not parsed.hostname or parsed.username or parsed.password or parsed.fragment:
        raise ValueError("Invalid probe URL")
    return parsed.hostname.lower(), parsed.port or (443 if parsed.scheme == "https" else 80)


class SafeRedirects(urllib.request.HTTPRedirectHandler):
    def __init__(self, allowed, https_only=False):
        self.allowed, self.https_only, self.count = allowed, https_only, 0

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        self.count += 1
        if self.count > 5 or endpoint(newurl) not in self.allowed or (self.https_only and urllib.parse.urlsplit(newurl).scheme != "https"):
            raise ValueError("Redirect left the configured endpoints")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def http_get(url, allowed, timeout=10):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), SafeRedirects(allowed, urllib.parse.urlsplit(url).scheme == "https"))
    request = urllib.request.Request(url, headers={"User-Agent": "WebsiteAudit/1.0 (read-only health check)"})
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        deadline, chunks, size = time.monotonic() + timeout, [], 0
        while size <= MAX_BODY:
            if time.monotonic() >= deadline:
                raise TimeoutError("HTTP body deadline exceeded")
            read = getattr(response, "read1", response.read)
            chunk = read(min(8192, MAX_BODY + 1 - size))
            if not chunk:
                break
            chunks.append(chunk)
            size += len(chunk)
        body = b"".join(chunks)
        return {"status": response.status, "headers": {k.lower(): v for k, v in response.headers.items()}, "body": body[:MAX_BODY], "truncated": len(body) > MAX_BODY}


def url_checks(config):
    entries = config.get("urls", [])
    allowed = {endpoint(entry["url"]) for entry in entries}
    checks, origins, tls_hosts = [], set(), set()
    if not entries:
        checks.append(result("http", "http", "skipped", "No URL probes configured"))
    for index, entry in enumerate(entries, 1):
        name = "http-" + str(index)
        try:
            response = http_get(entry["url"], allowed, min(30, max(1, int(entry.get("timeout", 10)))))
            expected = entry.get("status", 200)
            expected = [expected] if isinstance(expected, int) else expected
            missing = [key.lower() for key, value in entry.get("required_headers", {}).items()
                       if key.lower() not in response["headers"] or str(value).lower() not in response["headers"][key.lower()].lower()]
            healthy = response["status"] in expected and not missing
            checks.append(result(name, "http", "pass" if healthy else "fail", "HTTP status and configured headers checked", status_code=response["status"], missing_headers=missing))
        except (OSError, ValueError, urllib.error.URLError):
            checks.append(result(name, "http", "error", "HTTP probe failed or redirect was blocked"))
        parsed = urllib.parse.urlsplit(entry["url"])
        origins.add(urllib.parse.urlunsplit((parsed.scheme, parsed.netloc, "", "", "")))
        if parsed.scheme == "https":
            tls_hosts.add(endpoint(entry["url"]))
    for index, (hostname, port) in enumerate(sorted(tls_hosts), 1):
        try:
            with socket.create_connection((hostname, port), timeout=10) as sock:
                with ssl.create_default_context().wrap_socket(sock, server_hostname=hostname) as secure:
                    expires = ssl.cert_time_to_seconds(secure.getpeercert()["notAfter"])
            days = int((expires - time.time()) // 86400)
            checks.append(result("tls-" + str(index), "tls", "fail" if days < 0 else "warn" if days < int(config.get("tls_expiry_days", 14)) else "pass", "TLS chain, host name and expiry checked", days_remaining=days))
        except (OSError, ValueError, KeyError):
            checks.append(result("tls-" + str(index), "tls", "error", "TLS verification failed"))
    for index, origin in enumerate(sorted(origins), 1):
        for path, matcher, label in (("/.env", ENV_EXPOSURE, "env"), ("/.git/HEAD", GIT_EXPOSURE, "git")):
            try:
                response = http_get(origin + path, allowed)
                exposed = response["status"] == 200 and bool(matcher.search(response["body"]))
                incomplete = response["status"] >= 500 or response["truncated"]
                message = "Sensitive-file signature exposed" if exposed else "Exposure probe coverage incomplete" if incomplete else "No sensitive-file signature in the bounded response"
                checks.append(result(f"exposure-{index}-{label}", "exposure", "fail" if exposed else "error" if incomplete else "pass", message, status_code=response["status"], response_truncated=response["truncated"]))
            except (OSError, ValueError, urllib.error.URLError):
                checks.append(result(f"exposure-{index}-{label}", "exposure", "error", "Exposure probe could not complete"))
    return checks


def structured_log_counts(data):
    counts = {"error": 0, "warn": 0, "other": 0, "unstructured": 0}
    for line in data.splitlines():
        try:
            item = json.loads(line)
            level = item.get("level", item.get("severity")) if isinstance(item, dict) else None
            if isinstance(level, str):
                level = level.lower()
            bucket = "error" if level in ("error", "fatal", "critical") or isinstance(level, int) and level >= 50 else "warn" if level in ("warn", "warning") or isinstance(level, int) and level >= 40 else "other" if level is not None else "unstructured"
        except (ValueError, UnicodeError):
            bucket = "unstructured"
        counts[bucket] += 1
    return counts


def server_checks(config, env=None):
    checks = []
    try:
        disk = shutil.disk_usage(config.get("disk_path", "/"))
        used = round(100 * disk.used / disk.total, 1)
        checks.append(result("disk", "server", "fail" if used >= 97 else "warn" if used >= 90 else "pass", "Filesystem usage checked", used_percent=used))
    except OSError:
        checks.append(result("disk", "server", "error", "Filesystem usage unavailable"))
    if sys.platform.startswith("linux"):
        pending = Path("/var/run/reboot-required").exists()
        checks.append(result("reboot", "server", "warn" if pending else "pass", "Reboot marker checked; no reboot performed", required=pending))
        apt = run_process(["apt", "list", "--upgradable"], 20, env=env)
        if apt["error"] or apt["returncode"] != 0 or apt["truncated"]:
            checks.append(result("apt-cache", "server", "error", "Cached package status unavailable"))
        else:
            count = sum(bool(re.match(rb"^[^\s/]+/\S+\s+\S+", line)) for line in apt["output"].splitlines())
            lists = Path("/var/lib/apt/lists")
            timestamps = [p.stat().st_mtime for p in lists.glob("*_Packages*") if p.is_file()]
            age = int((time.time() - max(timestamps)) // 86400) if timestamps else None
            checks.append(result("apt-cache", "server", "warn" if count or age is None or age > 7 else "pass", "Cached APT status only; no refresh or update performed", available_packages=count, cache_age_days=age))
    else:
        checks.append(result("apt-reboot", "server", "skipped", "Linux APT/reboot checks are unavailable on this host"))
    containers = config.get("docker_containers", [])
    if not containers:
        if config.get("docker_checks_required", True) is False:
            checks.append(result("docker-scope", "server", "pass", "Docker checks outside this site configuration"))
        else:
            checks.append(result("docker", "server", "skipped", "No container probes configured"))
    for name in containers:
        inspected = run_process(["docker", "inspect", "--format", "{{json .State}}", name], 20, env=env)
        try:
            state = json.loads(inspected["output"])
            if inspected["error"] or inspected["returncode"] or inspected["truncated"] or not isinstance(state, dict):
                raise ValueError()
            running = state.get("Running") is True
            health = state.get("Health", {}).get("Status", "not_configured")
            checks.append(result("container-" + name, "docker", "fail" if not running or health == "unhealthy" else "warn" if health in ("starting", "not_configured") else "pass", "Container runtime and configured health checked", running=running, health=health))
        except (ValueError, UnicodeError, AttributeError):
            checks.append(result("container-" + name, "docker", "error", "Container inspect unavailable"))
        logs = run_process(["docker", "logs", "--since", "24h", "--tail", "2000", name], 30, env=env)
        if logs["error"] or logs["returncode"]:
            checks.append(result("logs-" + name, "docker", "error", "Bounded structured log counts unavailable"))
        else:
            counts = structured_log_counts(logs["output"])
            checks.append(result("logs-" + name, "docker", "warn" if counts["error"] or counts["warn"] or counts["unstructured"] or logs["truncated"] else "pass", "Counts only from the latest 2000 log lines within 24 hours", **counts, truncated=logs["truncated"]))
    return checks


def validate_config(config):
    if not isinstance(config, dict) or not re.fullmatch(r"[a-z0-9][a-z0-9-]{0,63}", config.get("id", "")):
        raise ValueError("A safe site id is required")
    if config.get("cadence") not in (None, "monthly") or not 1 <= int(config.get("interval_days", 14)) <= 366:
        raise ValueError("Invalid full-audit cadence")
    if not 1 <= int(config.get("retention_days", 90)) <= 90:
        raise ValueError("Retention must be between 1 and 90 days")
    if not isinstance(config.get("docker_checks_required", True), bool):
        raise ValueError("docker_checks_required must be a boolean")
    for entry in config.get("urls", []):
        endpoint(entry["url"])
        if not isinstance(entry.get("required_headers", {}), dict):
            raise ValueError("Required headers must map names to substrings")
    for container in config.get("docker_containers", []):
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9_.-]*", container):
            raise ValueError("Unsafe container identifier")
    names = set()
    for command in config.get("commands", []):
        if not isinstance(command.get("name"), str) or not re.fullmatch(r"[a-zA-Z0-9][a-zA-Z0-9_.-]{0,79}", command["name"]) or command["name"] in names:
            raise ValueError("Command names must be unique")
        names.add(command["name"])
        if not isinstance(command.get("argv"), list) or not command["argv"] or not all(isinstance(v, str) and v for v in command["argv"]):
            raise ValueError("Commands require a nonempty argv array")
        if command.get("parser", "generic") not in ("generic", "npm-audit", "npm-outdated", "eslint", "gitleaks", "check-bundle"):
            raise ValueError("Unknown command parser")
        if not 0 < float(command.get("timeout", 120)) <= 7200:
            raise ValueError("Command timeout must be bounded")
    return config


def collect(config, full, env=None):
    checks = url_checks(config) + server_checks(config, env)
    commands = config.get("commands", [])
    covered = set()
    for command in commands:
        if full or not command.get("full_only", True):
            completed = command_result(command, env)
            if command.get("parser") == "check-bundle" and not isinstance(completed, list):
                completed = [completed]
            if isinstance(completed, list):
                checks.extend(completed)
                covered.update(check.get("category") for check in completed if check.get("category"))
                expected = set(command.get("required_categories", FULL_CATEGORIES))
                missing = expected - {check.get("category") for check in completed}
                for category in sorted(missing):
                    checks.append(result(command["name"] + "/coverage-" + category, "repository", "skipped", "Required repository bundle category is missing"))
            else:
                checks.append(completed)
                if command.get("parser") != "check-bundle":
                    covered.add(command.get("category", command["name"]))
    if full:
        for category in sorted(set(config.get("required_categories", FULL_CATEGORIES)) - covered):
            checks.append(result("coverage-" + category, "repository", "skipped", "Required full-audit category is not configured"))
    return checks


def overall_status(checks):
    statuses = {check["status"] for check in checks}
    return "fail" if "fail" in statuses else "incomplete" if statuses & {"error", "skipped"} else "warn" if "warn" in statuses else "pass"


def issue_fingerprint(checks):
    # Counts may fluctuate; daily identity is the stable issue name/status/message.
    identities = sorted((c["name"], c["kind"], c["status"], c["message"]) for c in checks if c["status"] != "pass")
    return hashlib.sha256(json.dumps(identities, ensure_ascii=True).encode()).hexdigest()


def load_webhook(config, environment=None):
    environment = os.environ if environment is None else environment
    key = config.get("discord_env", "DISCORD_WEBHOOK_URL")
    value = environment.get(key, "").strip()
    if not value and config.get("discord_secret_file"):
        path = Path(config["discord_secret_file"])
        info = path.stat()
        if path.is_symlink() or not stat.S_ISREG(info.st_mode) or info.st_size > 16384:
            raise ValueError("Invalid Discord secret file")
        if os.name != "nt" and (stat.S_IMODE(info.st_mode) & 0o077 or info.st_uid != os.getuid()):
            raise ValueError("Discord secret file must be owned by the runner and mode 0600")
        for line in path.read_text(encoding="utf-8-sig").splitlines():
            line = line.strip()
            if not line or line.startswith("#"):
                continue
            match = re.fullmatch(r"(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)", line)
            if match and match[1] == key:
                value = match[2].strip()
                if len(value) >= 2 and value[0] == value[-1] and value[0] in "\"'":
                    value = value[1:-1]
                break
    parsed = urllib.parse.urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != "discord.com" or parsed.port not in (None, 443) or parsed.username or parsed.password or parsed.query or parsed.fragment or not WEBHOOK_PATH.fullmatch(parsed.path):
        raise ValueError("A valid Discord webhook secret is required")
    return value


class NoRedirects(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError("Webhook redirects are forbidden")


def webhook_transport(url, payload, timeout):
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirects())
    request = urllib.request.Request(url, data=json.dumps(payload).encode(), headers={"Content-Type": "application/json", "User-Agent": "WebsiteAudit/1.0"}, method="POST")
    try:
        response = opener.open(request, timeout=timeout)
    except urllib.error.HTTPError as exc:
        response = exc
    with response:
        return response.status, response.headers, response.read(16384)


def send_discord(webhook, content, transport=webhook_transport, sleep=time.sleep):
    payload = {"content": content[:1900], "allowed_mentions": {"parse": []}}
    for attempt in range(3):
        try:
            status, headers, body = transport(webhook + "?wait=true", payload, 20)
        except (OSError, ValueError, urllib.error.URLError):
            return False
        if status in (200, 204):
            return True
        if status != 429 or attempt == 2:
            return False
        try:
            retry = json.loads(body).get("retry_after", headers.get("Retry-After", 1))
            retry = max(0.0, float(retry))
        except (ValueError, TypeError, AttributeError):
            return False
        if retry > 30:
            return False  # Keep the outbox instead of retrying sooner than Discord permits.
        sleep(retry)
    return False


def summary(report):
    checks = report["checks"] + report.get("previous_full_issues", [])
    counts = {key: sum(c["status"] == key for c in checks) for key in ("pass", "warn", "fail", "error", "skipped")}
    mode = "FULL" if report["full"] else "DAILY"
    lines = [f"{report['site']} {mode} audit: {report['status']}", report["timestamp"], ", ".join(f"{key}={value}" for key, value in counts.items())]
    status_priority = {"fail": 0, "error": 1, "skipped": 2, "warn": 3}
    kind_priority = {"repository": 0, "exposure": 1, "tls": 2, "http": 3, "docker": 4, "server": 5}
    issues = sorted((c for c in checks if c["status"] != "pass"),
                    key=lambda c: (status_priority.get(c["status"], 4), kind_priority.get(c["kind"], 6), c["name"]))
    lines += [f"- {c['name']}: {c['status']} — {c['message']}" for c in issues][:12]
    lines.append("Private reports retained on the audit host. Read-only checks; no updates or deployment performed.")
    return redact("\n".join(lines))[:1900]


def flush_outbox(directory, state, webhook, sender=send_discord):
    for path in sorted(directory.glob("*.json")):
        item = read_json(path, {})
        if not sender(webhook, item["content"]):
            return False
        state.setdefault("notified", {})[item["day"]] = item["fingerprint"]
        atomic_json(directory.parent / "state.json", state)
        path.unlink()
    return True


def rotate_log(path, line, limit=1024 * 1024):
    line = redact(line).replace("\n", " ")[:2000] + "\n"
    if path.exists() and path.stat().st_size + len(line.encode()) > limit:
        os.replace(path, path.with_name(path.name + ".1"))
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_APPEND, 0o600)
    with os.fdopen(fd, "a", encoding="utf-8") as handle:
        handle.write(line)
    os.chmod(path, 0o600)


def save_report(directory, report, retention_days):
    private_dir(directory)
    basename = report["timestamp"].replace(":", "-") + "-" + uuid.uuid4().hex[:8]
    atomic_json(directory / (basename + ".json"), report)
    markdown = [f"# {report['site']} audit", "", f"Time: {report['timestamp']}", f"Mode: {'full' if report['full'] else 'daily'}", f"Status: {report['status']}", "", "| Check | Status | Evidence |", "| --- | --- | --- |"]
    for check in report["checks"] + report.get("previous_full_issues", []):
        evidence = check["message"] + (" " + json.dumps(check["metrics"], ensure_ascii=False) if check["metrics"] else "")
        markdown.append(f"| {check['name']} | {check['status']} | {evidence.replace('|', '/')} |")
    markdown += ["", "Source, HTTP and host checks do not verify authenticated browser, OAuth, payment, upload, native PDF or device journeys."]
    path = directory / (basename + ".md")
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write("\n".join(markdown) + "\n")
    cutoff = time.time() - retention_days * 86400
    for old in directory.iterdir():
        if not old.is_symlink() and old.is_file() and old.suffix in (".md", ".json") and old.stat().st_mtime < cutoff:
            old.unlink()


def run_site(config, state_root, mode="due", no_discord=False, now=None, collector=collect, sender=send_discord):
    validate_config(config)
    now = now or utcnow()
    directory = Path(state_root) / config["id"]
    private_dir(directory)
    with site_lock(directory / "audit.lock"):
        state = read_json(directory / "state.json", {})
        outbox = directory / "outbox"
        private_dir(outbox)
        webhook = None
        delivery_ok = True
        if not no_discord:
            try:
                webhook = load_webhook(config)
                delivery_ok = flush_outbox(outbox, state, webhook, sender)
            except (OSError, ValueError):
                delivery_ok = False
        full = mode == "full" or mode == "due" and full_due(config, state, now)
        environment = {k: v for k, v in os.environ.items() if k not in {config.get("discord_env", "DISCORD_WEBHOOK_URL"), "DISCORD_WEBHOOK_URL"}}
        checks = collector(config, full, environment)
        previous = state.get("open_full_issues", [])
        if full:
            completed = {(c["name"], c["kind"]) for c in checks if c["status"] in ("pass", "warn", "fail")}
            # An unavailable wrapper/scanner cannot resolve a previously observed source risk.
            previous = [c for c in previous if c["status"] in ("warn", "fail") and (c["name"], c["kind"]) not in completed]
        report = redact({"site": config["id"], "name": config.get("name", config["id"]), "timestamp": iso(now), "full": full,
                         "checks": checks, "previous_full_issues": previous, "status": overall_status(checks + previous),
                         "discord": "disabled" if no_discord else "pending"}, (webhook,) if webhook else ())
        if full:
            state["last_full_at"] = iso(now)
            state["open_full_issues"] = report["previous_full_issues"] + [c for c in report["checks"] if c["kind"] == "repository" and c["status"] != "pass"]
        # Reporting failures must never erase unresolved full-audit evidence.
        day = now.date().isoformat()
        fingerprint = issue_fingerprint(report["checks"] + previous)
        already_notified = state.get("notified", {}).get(day) == fingerprint
        has_issues = report["status"] != "pass"
        if not no_discord and (full or has_issues and not already_notified):
            pending = [read_json(p, {}) for p in outbox.glob("*.json")]
            duplicate = not full and any(i.get("day") == day and i.get("fingerprint") == fingerprint for i in pending)
            if not duplicate:
                atomic_json(outbox / (now.strftime("%Y%m%dT%H%M%S") + "-" + uuid.uuid4().hex[:8] + ".json"),
                            {"content": summary(report), "day": day, "fingerprint": fingerprint})
        atomic_json(directory / "state.json", state)
        if not no_discord and webhook and delivery_ok:
            delivery_ok = flush_outbox(outbox, state, webhook, sender)
        if not no_discord:
            report["discord"] = "delivered_or_deduplicated" if delivery_ok else "failed_pending_outbox"
        state["notified"] = {day: value for day, value in state.get("notified", {}).items() if day >= (now.date() - dt.timedelta(days=90)).isoformat()}
        atomic_json(directory / "state.json", state)
        save_report(directory / "reports", report, int(config.get("retention_days", 90)))
        rotate_log(directory / "audit.log", f"{iso(now)} {config['id']} {report['status']} discord={report['discord']}")
        exit_code = 2 if not delivery_ok else 1 if report["status"] in ("fail", "incomplete") else 0
        return report, exit_code


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--config", required=True)
    parser.add_argument("--state-dir", required=True)
    parser.add_argument("--mode", choices=("daily", "full", "due"), default="due")
    parser.add_argument("--no-discord", action="store_true")
    args = parser.parse_args(argv)
    try:
        config = read_json(Path(args.config), None)
        report, code = run_site(config, args.state_dir, args.mode, args.no_discord)
        print(f"{report['site']}: {report['status']}; discord={report['discord']}")
        return code
    except OverlapError:
        print("Audit skipped: a previous audit is still running", file=sys.stderr)
        return 75
    except Exception as exc:
        # Exception messages can contain credential-bearing URLs, commands or payloads.
        print("Audit could not complete: " + type(exc).__name__, file=sys.stderr)
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
