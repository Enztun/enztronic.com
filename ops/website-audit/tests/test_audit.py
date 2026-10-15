"""No external network, Docker, Discord, customer data or production changes."""
import contextlib
import datetime as dt
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
import unittest
from unittest import mock

SPEC = importlib.util.spec_from_file_location("website_audit", Path(__file__).resolve().parents[1] / "audit.py")
audit = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(audit)

WEBHOOK = "https://discord.com/api/v10/webhooks/123456789/fixture-secret-token"
NOW = dt.datetime(2026, 10, 16, 4, 0, tzinfo=audit.UTC)


def check(status="pass", name="fixture"):
    return audit.result(name, "repository", status, "Fixture check")


def bundle(categories=audit.FULL_CATEGORIES, status="pass"):
    return {"checks": [{"name": category, "category": category, "status": status, "metrics": {"errors": 0}} for category in sorted(categories)], "revision": "a" * 40}


class AuditTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.root = Path(self.temporary.name)
        self.config = {"id": "fixture", "interval_days": 14}

    def tearDown(self):
        self.temporary.cleanup()

    def collect(self, checks):
        return lambda *_args: checks

    def test_schedule_every_fourteen_days_and_calendar_month(self):
        previous = {"last_full_at": audit.iso(NOW)}
        self.assertTrue(audit.full_due(self.config, {}, NOW))
        self.assertFalse(audit.full_due(self.config, previous, NOW + dt.timedelta(days=13, hours=19, minutes=59)))
        self.assertTrue(audit.full_due(self.config, previous, NOW + dt.timedelta(days=14)))
        late_manual = NOW.replace(hour=23)
        early_cron = (late_manual + dt.timedelta(days=14)).replace(hour=19, minute=30)
        self.assertTrue(audit.full_due(self.config, {"last_full_at": audit.iso(late_manual)}, early_cron))
        self.assertFalse(audit.full_due(self.config, {"last_full_at": audit.iso(late_manual)}, early_cron - dt.timedelta(days=1)))
        january = dt.datetime(2027, 1, 31, 4, tzinfo=audit.UTC)
        state = {"last_full_at": audit.iso(january)}
        self.assertFalse(audit.full_due({"cadence": "monthly"}, state, dt.datetime(2027, 2, 27, 23, 59, tzinfo=audit.UTC)))
        self.assertTrue(audit.full_due({"cadence": "monthly"}, state, dt.datetime(2027, 2, 28, 0, 0, tzinfo=audit.UTC)))

    def test_daily_mode_does_not_run_a_due_full_audit(self):
        modes = []
        def collector(_config, full, _env):
            modes.append(full)
            return [check()]
        audit.run_site(self.config, self.root, "daily", True, NOW, collector)
        audit.run_site(self.config, self.root, "due", True, NOW, collector)
        self.assertEqual(modes, [False, True])

    def test_overlap_is_blocked(self):
        path = self.root / "audit.lock"
        with audit.site_lock(path):
            with self.assertRaises(audit.OverlapError):
                with audit.site_lock(path):
                    self.fail("The second process must not enter")

    def test_timeout_and_output_are_bounded_and_private(self):
        began = time.monotonic()
        process = audit.run_process([sys.executable, "-c", "import time; time.sleep(30)"], 0.1)
        self.assertEqual(process["error"], "timeout")
        self.assertLess(time.monotonic() - began, 5)
        process = audit.run_process([sys.executable, "-c", "print('x' * 10000)"], 5, output_limit=100)
        self.assertTrue(process["truncated"])
        self.assertEqual(len(process["output"]), 100)

    def test_no_shell_command_interpretation(self):
        literal = "$(touch should-not-exist); & echo secret"
        process = audit.run_process([sys.executable, "-c", "import sys;print(sys.argv[1])", literal], 5)
        self.assertEqual(process["output"].decode().strip(), literal)
        self.assertFalse((self.root / "should-not-exist").exists())

    def test_exposure_requires_positive_signature(self):
        self.assertFalse(audit.ENV_EXPOSURE.search(b"<html>Login required</html>"))
        self.assertFalse(audit.GIT_EXPOSURE.search(b"<html>ref: refs/heads/main</html>"))
        self.assertTrue(audit.ENV_EXPOSURE.search(b"DATABASE_URL=postgres://fixture\n"))
        self.assertTrue(audit.GIT_EXPOSURE.search(b"ref: refs/heads/main\n"))

    def test_truncated_negative_exposure_is_incomplete_but_positive_still_fails(self):
        config = {**self.config, "urls": [{"url": "http://fixture.example/"}]}
        def response(url, *_args):
            return {"status": 200, "headers": {}, "body": b"ref: refs/heads/main\n" if url.endswith("/.git/HEAD") else b"<html>fixture</html>", "truncated": url != "http://fixture.example/"}
        with mock.patch.object(audit, "http_get", side_effect=response):
            checks = {item["name"]: item for item in audit.url_checks(config)}
        self.assertEqual(checks["exposure-1-env"]["status"], "error")
        self.assertEqual(checks["exposure-1-git"]["status"], "fail")

    def test_redirects_cannot_leave_configured_hosts_or_downgrade_tls(self):
        redirects = audit.SafeRedirects({("allowed.example", 443)}, True)
        request = audit.urllib.request.Request("https://allowed.example/")
        for url in ["https://outside.example/", "http://allowed.example/", "https://allowed.example:444/"]:
            with self.assertRaises(ValueError):
                redirects.redirect_request(request, None, 302, "redirect", {}, url)

    def test_structured_logs_output_counts_without_customer_text(self):
        logs = b'{"level":50,"message":"customer@example.test password=hidden"}\n{"level":"warn","request":{"body":"secret"}}\nplain text\n{"level":30}\n'
        counts = audit.structured_log_counts(logs)
        self.assertEqual(counts, {"error": 1, "warn": 1, "other": 1, "unstructured": 1})
        self.assertNotIn("customer", json.dumps(counts))

    def test_empty_docker_scope_requires_explicit_boolean_opt_out(self):
        for value in [None, 0, 1, 'false', [], {}]:
            with self.assertRaises(ValueError):
                audit.validate_config({**self.config, "docker_checks_required": value})
        for flag in [True, False]:
            audit.validate_config({**self.config, "docker_checks_required": flag})
        for config, expected in [(self.config, 'skipped'), ({**self.config, 'docker_checks_required': True}, 'skipped'), ({**self.config, 'docker_checks_required': False}, 'pass')]:
            with mock.patch.object(audit.sys, 'platform', 'fixture-nonlinux'):
                rows = [row for row in audit.server_checks(config, {}) if row['name'] in ('docker', 'docker-scope')]
            self.assertEqual(len(rows), 1)
            self.assertEqual(rows[0]['status'], expected)
            if expected == 'pass':
                self.assertEqual(rows[0]['name'], 'docker-scope')
                self.assertEqual(rows[0]['message'], 'Docker checks outside this site configuration')
                self.assertEqual(rows[0]['metrics'], {})
                self.assertEqual(audit.overall_status([check(), rows[0]]), 'pass')
            else:
                self.assertEqual(audit.overall_status(rows), 'incomplete')

    def test_docker_opt_out_cannot_hide_configured_container_or_log_errors(self):
        config = {**self.config, 'docker_checks_required': False, 'docker_containers': ['fixture']}
        failed = {'error': 'fixture_unavailable', 'returncode': None, 'output': b'', 'truncated': False}
        with mock.patch.object(audit.sys, 'platform', 'fixture-nonlinux'), mock.patch.object(audit, 'run_process', return_value=failed) as request:
            rows = [row for row in audit.server_checks(config, {}) if row['kind'] == 'docker']
        self.assertEqual(request.call_count, 2)
        self.assertEqual(len(rows), 2)
        self.assertTrue(all(row['status'] == 'error' for row in rows))
        self.assertEqual(audit.overall_status(rows), 'incomplete')

    def test_docker_scope_does_not_satisfy_or_disable_other_required_coverage(self):
        scope = audit.result('docker-scope', 'server', 'pass', 'Docker checks outside this site configuration')
        config = {**self.config, 'docker_checks_required': False}
        with mock.patch.object(audit, 'url_checks', return_value=[]), mock.patch.object(audit, 'server_checks', return_value=[scope]):
            checks = audit.collect(config, True)
        self.assertEqual(sum(row['name'].startswith('coverage-') for row in checks), 8)
        self.assertEqual(audit.overall_status(checks), 'incomplete')
        self.assertEqual(audit.overall_status([scope, audit.result('http', 'http', 'error', 'Unavailable')]), 'incomplete')
        profile = json.loads((Path(audit.__file__).parent / 'sites' / 'enztronic.json').read_text(encoding='utf-8'))
        self.assertIs(profile['docker_checks_required'], False)
        self.assertEqual(profile['docker_containers'], [])

    def test_webhook_secret_file_is_parsed_and_never_executed(self):
        secret = self.root / ".env.monitoring"
        secret.write_text('DISCORD_WEBHOOK_URL="' + WEBHOOK + '"\nIGNORED=$(touch dangerous)\n', encoding="utf-8")
        os.chmod(secret, 0o600)
        config = {**self.config, "discord_secret_file": str(secret)}
        self.assertEqual(audit.load_webhook(config, {}), WEBHOOK)
        self.assertFalse((self.root / "dangerous").exists())
        if os.name != "nt":
            os.chmod(secret, 0o644)
            with self.assertRaises(ValueError):
                audit.load_webhook(config, {})

    def test_webhook_hosts_paths_queries_and_credentials_are_restricted(self):
        self.assertEqual(audit.load_webhook(self.config, {"DISCORD_WEBHOOK_URL": WEBHOOK}), WEBHOOK)
        for url in [WEBHOOK.replace("discord.com", "discord.com.evil.test"), WEBHOOK.replace("https:", "http:"), WEBHOOK + "?wait=true", WEBHOOK.replace("discord.com", "user:pass@discord.com"), "https://discord.com/api/other", "https://discordapp.com/api/webhooks/123/token"]:
            with self.assertRaises(ValueError):
                audit.load_webhook(self.config, {"DISCORD_WEBHOOK_URL": url})

    def test_redaction_removes_webhook_and_inline_secret_values(self):
        text = audit.redact({"detail": WEBHOOK + " password=my-password Authorization: Bearer private.token"})
        output = json.dumps(text)
        self.assertNotIn("fixture-secret-token", output)
        self.assertNotIn("my-password", output)
        self.assertNotIn("private.token", output)

    def test_discord_retries_429_with_wait_and_disabled_mentions(self):
        calls, sleeps = [], []
        def transport(url, payload, timeout):
            calls.append((url, payload, timeout))
            return (429, {"Retry-After": "2"}, b'{"retry_after":2}') if len(calls) == 1 else (200, {}, b'{}')
        self.assertTrue(audit.send_discord(WEBHOOK, "@everyone status", transport, sleeps.append))
        self.assertEqual(sleeps, [2.0])
        self.assertEqual(len(calls), 2)
        self.assertTrue(calls[0][0].endswith("?wait=true"))
        self.assertEqual(calls[0][1]["allowed_mentions"], {"parse": []})
        self.assertFalse(audit.send_discord(WEBHOOK, "status", lambda *_: (429, {}, b'{"retry_after":100}'), lambda _: self.fail("Do not retry before the permitted delay")))

    def test_failed_delivery_retains_outbox_and_does_not_advance_notifications(self):
        with mock.patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": WEBHOOK}):
            report, code = audit.run_site(self.config, self.root, "full", False, NOW, self.collect([check("fail")]), lambda *_: False)
        directory = self.root / "fixture"
        self.assertEqual(code, 2)
        self.assertEqual(report["discord"], "failed_pending_outbox")
        self.assertEqual(len(list((directory / "outbox").glob("*.json"))), 1)
        self.assertEqual(audit.read_json(directory / "state.json", {})["notified"], {})
        content = "".join(path.read_text(encoding="utf-8") for path in directory.rglob("*") if path.is_file())
        self.assertNotIn("fixture-secret-token", content)
        delivered = []
        with mock.patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": WEBHOOK}):
            report, code = audit.run_site(self.config, self.root, "daily", False, NOW, self.collect([check()]), lambda _url, message: delivered.append(message) or True)
        self.assertEqual(len(list((directory / "outbox").glob("*.json"))), 0)
        self.assertTrue(delivered)
        self.assertNotEqual(audit.read_json(directory / "state.json", {})["notified"], {})
        self.assertEqual(report["status"], "fail")  # A green HTTP check cannot clear failed source evidence.
        self.assertEqual(code, 1)

    def test_daily_issues_are_deduplicated_and_full_summaries_always_send(self):
        sent = []
        sender = lambda _url, message: sent.append(message) or True
        with mock.patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": WEBHOOK}):
            for mode in ("daily", "daily", "full", "full"):
                audit.run_site(self.config, self.root, mode, False, NOW, self.collect([check("warn")]), sender)
        self.assertEqual(len(sent), 3)

    def test_critical_failure_is_visible_after_many_earlier_host_warnings(self):
        checks = [audit.result("host-" + str(n), "server", "warn", "Host warning") for n in range(20)]
        checks.append(audit.result("secret-scan", "repository", "fail", "Secret scanner found a risk"))
        report = {"site": "fixture", "timestamp": audit.iso(NOW), "status": "fail", "full": True, "checks": checks}
        message = audit.summary(report)
        self.assertIn("secret-scan: fail", message)
        self.assertLess(message.index("secret-scan: fail"), message.index("host-0: warn"))
        self.assertLessEqual(len(message), 1900)

    def test_summary_renders_actionable_counts_without_string_or_raw_metrics(self):
        checks = [audit.result("source", "repository", "fail", "Isolated check fail",
                               findings=9, high=3, critical=0, raw_log="private-log-canary",
                               errors="secret-metric-canary", warnings=WEBHOOK,
                               revision="a" * 40, low={"high": 500})]
        report = {"site": "fixture", "timestamp": audit.iso(NOW), "status": "fail", "full": True, "checks": checks}
        message = audit.summary(report)
        self.assertIn("findings=9", message)
        self.assertIn("high=3", message)
        self.assertIn("critical=0", message)
        for withheld in ("private-log-canary", "secret-metric-canary", WEBHOOK, "fixture-secret-token", "https://", "a" * 40, "high=500"):
            self.assertNotIn(withheld, message)

    def test_summary_bounds_metric_count_and_rejects_negative_or_noninteger_values(self):
        metrics = {key: n for n, key in enumerate(("findings", "critical", "high", "moderate", "low", "total", "packages", "errors"))}
        rendered = audit.summary_metrics(metrics)
        self.assertEqual(rendered, "findings=0, critical=1, high=2, moderate=3, low=4, total=5")
        rendered = audit.summary_metrics({"findings": -1, "critical": float("inf"), "high": float("nan"),
                                          "low": 0.5, "total": "4", "packages": False, "available_packages": 12,
                                          "required": True})
        self.assertEqual(rendered, "packages=false, available_packages=12, required=true")
        self.assertEqual(audit.summary_metrics(["private-metric-canary"]), "")

    def test_full_failure_persists_until_a_real_full_check_clears_it(self):
        audit.run_site(self.config, self.root, "full", True, NOW, self.collect([check("fail")]))
        report, code = audit.run_site(self.config, self.root, "daily", True, NOW, self.collect([check()]))
        self.assertEqual(report["status"], "fail")
        self.assertEqual(code, 1)
        report, code = audit.run_site(self.config, self.root, "full", True, NOW, self.collect([check()]))
        self.assertEqual(report["status"], "pass")
        self.assertEqual(code, 0)

    def test_daily_health_recovery_clears_a_previous_full_run_health_failure(self):
        health = audit.result("http-1", "http", "fail", "HTTP fixture outage")
        audit.run_site(self.config, self.root, "full", True, NOW, self.collect([health]))
        report, code = audit.run_site(self.config, self.root, "daily", True, NOW, self.collect([check()]))
        self.assertEqual(report["status"], "pass")
        self.assertEqual(code, 0)

    def test_incomplete_full_scan_cannot_erase_a_previous_vulnerability(self):
        risk = check("fail", "audit-prod")
        audit.run_site(self.config, self.root, "full", True, NOW, self.collect([risk]))
        for replacement in ([check("error", "audit-prod")], [check("error", "wrapper-unavailable")]):
            report, code = audit.run_site(self.config, self.root, "full", True, NOW, self.collect(replacement))
            self.assertEqual(report["status"], "fail")
            self.assertEqual(code, 1)
            self.assertIn(risk, report["previous_full_issues"])
        report, _code = audit.run_site(self.config, self.root, "daily", True, NOW, self.collect([check()]))
        self.assertIn(risk, report["previous_full_issues"])
        report, code = audit.run_site(self.config, self.root, "full", True, NOW, self.collect([check("pass", "audit-prod")]))
        self.assertEqual(report["status"], "pass")
        self.assertEqual(code, 0)

    def test_missing_full_coverage_is_explicit_and_never_passes(self):
        with mock.patch.object(audit, "url_checks", return_value=[]), mock.patch.object(audit, "server_checks", return_value=[]):
            checks = audit.collect(self.config, True)
        self.assertEqual(len(checks), 8)
        self.assertTrue(all(item["status"] == "skipped" for item in checks))
        self.assertEqual(audit.overall_status(checks), "incomplete")

    def test_bundle_uses_only_validated_categories_and_allowlisted_metrics(self):
        payload = bundle()
        payload["checks"][0]["metrics"]["raw_log"] = "password=do-not-output"
        payload["checks"][0]["metrics"].update(readiness_failed=True, timed_out=True, first_error_code=1)
        checks = audit.bundle_results("frontend", payload, 0)
        self.assertEqual(len(checks), 8)
        self.assertEqual(checks[0]["metrics"]["revision"], "a" * 40)
        self.assertTrue(checks[0]["metrics"]["readiness_failed"])
        self.assertTrue(checks[0]["metrics"]["timed_out"])
        self.assertEqual(checks[0]["metrics"]["first_error_code"], 1)
        self.assertNotIn("do-not-output", json.dumps(checks))
        payload["checks"][0]["metrics"]["errors"] = WEBHOOK
        self.assertEqual(audit.bundle_results("frontend", payload, 0)[0]["status"], "error")
        self.assertEqual(audit.bundle_results("frontend", bundle(status="blocked"), 1)[0]["status"], "error")
        self.assertEqual(audit.bundle_results("frontend", {"checks": []}, 0)[0]["status"], "error")

    def test_bundle_accepts_setup_and_multiple_named_checks_per_required_category(self):
        payload = bundle()
        payload["checks"] += [{"name": "Backend image packaging", "category": "build", "status": "pass", "metrics": {}}, {"name": "Dependency install", "category": "setup", "status": "pass", "metrics": {"execution_error": False}}]
        self.assertEqual(len(audit.bundle_results("backend", payload, 0)), 10)

    def test_runtime_log_bundle_is_not_persisted_as_a_source_failure(self):
        blocked = audit.bundle_results("frontend-logs", {"checks": [{"name": "Vercel log counts", "category": "logs", "status": "blocked", "metrics": {"credential_required": True}}]}, 1)
        self.assertEqual(blocked[0]["kind"], "runtime-logs")
        self.assertTrue(blocked[0]["metrics"]["credential_required"])
        audit.run_site(self.config, self.root, "full", True, NOW, self.collect(blocked))
        report, code = audit.run_site(self.config, self.root, "daily", True, NOW, self.collect([audit.result("frontend-logs/Vercel log counts", "runtime-logs", "pass", "Logs recovered")]))
        self.assertEqual(report["status"], "pass")
        self.assertEqual(code, 0)

    def test_bundle_coverage_is_checked_per_repository(self):
        config = {**self.config, "commands": [{"name": "frontend", "argv": ["fixture"], "parser": "check-bundle"}, {"name": "backend", "argv": ["fixture"], "parser": "check-bundle"}]}
        returned = [audit.bundle_results("frontend", bundle(), 0), audit.bundle_results("backend", bundle({"lint"}), 0)]
        with mock.patch.object(audit, "url_checks", return_value=[]), mock.patch.object(audit, "server_checks", return_value=[]), mock.patch.object(audit, "command_result", side_effect=returned):
            checks = audit.collect(config, True)
        self.assertEqual(sum(c["status"] == "skipped" and c["name"].startswith("backend/") for c in checks), 7)
        self.assertEqual(audit.overall_status(checks), "incomplete")

    def test_nonzero_tool_exit_never_becomes_clean(self):
        zero_counts = {"metadata": {"vulnerabilities": {k: 0 for k in ("info", "low", "moderate", "high", "critical")}}}
        for parser, output in [("npm-audit", zero_counts), ("npm-outdated", {}), ("eslint", [{"errorCount": 0, "warningCount": 0}])]:
            process = {"error": None, "returncode": 1, "output": json.dumps(output).encode(), "truncated": False}
            with mock.patch.object(audit, "run_process", return_value=process):
                item = audit.command_result({"name": "check", "argv": ["fixture"], "parser": parser})
            self.assertEqual(item["status"], "error")

    def test_report_permissions_retention_and_log_rotation(self):
        report = {"site": "fixture", "timestamp": audit.iso(NOW), "full": True, "status": "pass", "checks": [check()]}
        reports = self.root / "reports"
        audit.save_report(reports, report, 90)
        old = reports / "old.json"
        old.write_text("{}", encoding="utf-8")
        os.utime(old, (time.time() - 91 * 86400,) * 2)
        audit.save_report(reports, report, 90)
        self.assertFalse(old.exists())
        if os.name != "nt":
            self.assertEqual(reports.stat().st_mode & 0o777, 0o700)
            self.assertTrue(all(p.stat().st_mode & 0o777 == 0o600 for p in reports.iterdir()))
        log = self.root / "audit.log"
        audit.rotate_log(log, "old report", 20)
        audit.rotate_log(log, "new current report", 20)
        self.assertIn("new current report", log.read_text())
        self.assertIn("old report", log.with_name("audit.log.1").read_text())

    def test_discord_secret_is_removed_from_child_process_environment(self):
        observed = []
        def collector(_config, _full, environment):
            observed.append(environment)
            return [check()]
        with mock.patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": WEBHOOK}):
            audit.run_site(self.config, self.root, "daily", True, NOW, collector)
        self.assertNotIn("DISCORD_WEBHOOK_URL", observed[0])

    def test_server_probe_subprocesses_do_not_inherit_webhook_environment(self):
        original_run = audit.run_process
        probes = []
        config = {**self.config, "docker_containers": ["fixture"], "discord_env": "CUSTOM_HOOK"}
        def subprocess_probe(argv, *args, env=None, **kwargs):
            child = original_run([sys.executable, "-c", "import os;print('DISCORD_WEBHOOK_URL' in os.environ, 'CUSTOM_HOOK' in os.environ)"], 5, env=env)
            self.assertEqual(child["output"].strip(), b"False False")
            probes.append(argv[:2])
            output = b'{"Running":true,"Health":{"Status":"healthy"}}' if "inspect" in argv else b''
            return {"error": None, "returncode": 0, "output": output, "truncated": False}
        with mock.patch.dict(os.environ, {"DISCORD_WEBHOOK_URL": WEBHOOK, "CUSTOM_HOOK": WEBHOOK}), mock.patch.object(audit, "url_checks", return_value=[]), mock.patch.object(audit.sys, "platform", "linux"), mock.patch.object(audit, "run_process", side_effect=subprocess_probe):
            audit.run_site(config, self.root, "daily", True, NOW)
        self.assertEqual(len(probes), 3)  # cached apt, container inspect, bounded logs

    def test_cli_exception_does_not_print_a_credential_url(self):
        config = self.root / "bad.json"
        config.write_text(json.dumps({"id": WEBHOOK}), encoding="utf-8")
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(output):
            self.assertEqual(audit.main(["--config", str(config), "--state-dir", str(self.root)]), 2)
        self.assertNotIn("fixture-secret-token", output.getvalue())


if __name__ == "__main__":
    unittest.main()
