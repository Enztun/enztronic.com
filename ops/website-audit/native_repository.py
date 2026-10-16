#!/usr/bin/env python3
"""Windows metadata-only Enztronic audit; never install or execute repository code."""
import argparse
import contextlib
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import signal
import stat
import subprocess
import tempfile
import threading

from audit import site_lock
from runner_config import PROJECT_ID, REPOSITORY_URL, prepare_runtime, runtime_root

REGISTRY = 'https://registry.npmjs.org/'
MAX_JSON = 8 * 1024 * 1024
NAME = re.compile(r'(?:@[a-z0-9][a-z0-9._-]*/)?[a-z0-9][a-z0-9._-]*\Z')
VERSION = re.compile(r'[0-9]+\.[0-9]+\.[0-9]+(?:[-+][0-9A-Za-z.+-]+)?\Z')


class ToolFailure(RuntimeError):
    def __init__(self, flag='execution_error'):
        self.flag = flag
        super().__init__('Native audit tool could not complete')


def private_file(path):
    if os.name == 'nt':
        from windows_support import validate_private_file
        validate_private_file(path)
    elif path.is_symlink() or not path.is_file() or path.stat().st_mode & 0o077:
        raise ValueError('Private tool configuration is required')


def write_private(path, content):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'w', encoding='utf-8', newline='\n') as output:
        output.write(content)
    if os.name == 'nt':
        from windows_support import secure_private_file
        secure_private_file(path)


def reject_reparse(path):
    if os.name == 'nt':
        from windows_support import reject_reparse_path
        reject_reparse_path(path)
    elif path.is_symlink():
        raise ValueError('Native audit path must not be a symlink')


def hidden_options():
    return {'creationflags': getattr(subprocess, 'CREATE_NO_WINDOW', 0x08000000)} if os.name == 'nt' else {'start_new_session': True}


def kill_owned_tree(process):
    if os.name == 'nt':
        # Only this Popen PID and its descendants; never enumerate/name-match processes.
        system = Path(os.environ.get('SystemRoot', 'C:/Windows')) / 'System32/taskkill.exe'
        try:
            completed = subprocess.run([str(system), '/PID', str(process.pid), '/T', '/F'],
                stdin=subprocess.DEVNULL, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                timeout=10, shell=False, **hidden_options())
        except (OSError, subprocess.TimeoutExpired):
            if process.poll() is None:
                process.kill()
            raise ToolFailure('cleanup_failed') from None
        if completed.returncode and process.poll() is None:
            process.kill()
            raise ToolFailure('cleanup_failed')
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGKILL)


def capture(argv, *, cwd, env, timeout=120, limit=MAX_JSON):
    process = subprocess.Popen([str(value) for value in argv], cwd=cwd, env=env,
        stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.STDOUT,
        shell=False, **hidden_options())
    chunks, size, overflow = [], 0, False

    def drain():
        nonlocal size, overflow
        while True:
            chunk = process.stdout.read(65536)
            if not chunk:
                break
            size += len(chunk)
            if size > limit:
                overflow = True
                break
            chunks.append(chunk)

    reader = threading.Thread(target=drain, daemon=True)
    reader.start()
    try:
        # Poll output overflow as well as the wall-clock deadline.
        import time
        deadline = time.monotonic() + timeout
        while process.poll() is None:
            if overflow or time.monotonic() >= deadline:
                kill_owned_tree(process)
                process.wait(timeout=10)
                raise ToolFailure('output_limit' if overflow else 'timed_out')
            try:
                process.wait(timeout=min(0.05, max(0.001, deadline - time.monotonic())))
            except subprocess.TimeoutExpired:
                pass
        reader.join(timeout=2)
        if reader.is_alive():
            kill_owned_tree(process)
            reader.join(timeout=2)
            raise ToolFailure('cleanup_failed')
        if overflow:
            raise ToolFailure('output_limit')
        return process.returncode, b''.join(chunks).decode('utf-8', 'strict')
    finally:
        if process.poll() is None:
            kill_owned_tree(process)
            process.wait(timeout=10)
        reader.join(timeout=2)
        if not reader.is_alive():
            process.stdout.close()


def check(name, category, status, **metrics):
    return {'name': name, 'category': category, 'status': status, 'metrics': metrics}


def blocked_runtime_checks():
    return [check('Native ' + category + ' unavailable without isolation', category, 'blocked',
                  errors=1, dedicated_browser_test_environment_required=True)
            for category in ('lint', 'typecheck', 'unit', 'build')]


def json_data(text):
    def pairs(items):
        result = {}
        for key, value in items:
            if key in result:
                raise ValueError('Duplicate JSON key')
            result[key] = value
        return result
    return json.loads(text, object_pairs_hook=pairs)


def read_private_json(path, limit=16384):
    private_file(path)
    if path.stat().st_size > limit:
        raise ValueError('Private configuration exceeds its bound')
    return json_data(path.read_text(encoding='utf-8-sig'))


def tools_for(root):
    tools = read_private_json(root / 'bin/tool-paths.json')
    if not isinstance(tools, dict) or set(tools) != {'git', 'node', 'npm_cli'}:
        raise ValueError('Exact native tool paths are required')
    for key, value in tools.items():
        path = Path(value) if isinstance(value, str) else Path()
        if not path.is_absolute() or not path.is_file() or path.is_symlink():
            raise ValueError('Native tool path must identify an existing absolute file')
        tools[key] = str(path.resolve())
    if Path(tools['git']).name.lower() != 'git.exe' or Path(tools['node']).name.lower() != 'node.exe' or Path(tools['npm_cli']).name != 'npm-cli.js':
        raise ValueError('Unexpected native tool identity')
    scanner = root / 'bin/gitleaks.exe'
    sidecar = root / 'bin/gitleaks.sha256'
    private_file(scanner)
    private_file(sidecar)
    if sidecar.stat().st_size > 128 or scanner.stat().st_size > 100 * 1024 * 1024:
        raise ValueError('Invalid scanner verification file')
    expected = sidecar.read_text(encoding='ascii').strip().lower()
    if not re.fullmatch(r'[0-9a-f]{64}', expected):
        raise ValueError('Scanner binary checksum is required')
    digest = hashlib.sha256()
    with scanner.open('rb') as source:
        for chunk in iter(lambda: source.read(65536), b''):
            digest.update(chunk)
    if digest.hexdigest() != expected:
        raise ValueError('Scanner checksum mismatch')
    tools['gitleaks'] = str(scanner)
    return tools


def anonymous_environment(work, root, tools):
    home = work / 'home'
    home.mkdir(mode=0o700)
    temp = home / 'tmp'
    temp.mkdir(mode=0o700)
    npm_user, npm_global = home / 'user.npmrc', home / 'global.npmrc'
    write_private(npm_user, 'registry=' + REGISTRY + '\nignore-scripts=true\nstrict-ssl=true\n')
    write_private(npm_global, '')
    system = os.environ.get('SystemRoot', 'C:/Windows')
    # A fresh HOME has no .netrc/.npmrc, Git credentials, SSH keys or Docker config.
    # No inherited tokens, proxy settings, NODE_OPTIONS or NPM_CONFIG_* survive.
    return {'SystemRoot': system, 'WINDIR': system,
        'PATH': os.pathsep.join([str(Path(tools['git']).parent), str(Path(tools['node']).parent), str(Path(system) / 'System32')]),
        'HOME': str(home), 'USERPROFILE': str(home), 'APPDATA': str(home / 'roaming'), 'LOCALAPPDATA': str(home / 'local'),
        'TEMP': str(temp), 'TMP': str(temp), 'GIT_TERMINAL_PROMPT': '0', 'GCM_INTERACTIVE': 'Never',
        'GIT_CONFIG_NOSYSTEM': '1', 'GIT_CONFIG_GLOBAL': os.devnull, 'GIT_CONFIG_SYSTEM': os.devnull,
        'GIT_CONFIG_COUNT': '3', 'GIT_CONFIG_KEY_0': 'credential.helper', 'GIT_CONFIG_VALUE_0': '',
        'GIT_CONFIG_KEY_1': 'http.followRedirects', 'GIT_CONFIG_VALUE_1': 'false',
        'GIT_CONFIG_KEY_2': 'core.hooksPath', 'GIT_CONFIG_VALUE_2': str(home / 'no-hooks'),
        'NPM_CONFIG_USERCONFIG': str(npm_user), 'NPM_CONFIG_GLOBALCONFIG': str(npm_global),
        'NPM_CONFIG_CACHE': str(root / 'cache/native-npm'), 'NPM_CONFIG_REGISTRY': REGISTRY,
        'NPM_CONFIG_IGNORE_SCRIPTS': 'true', 'NPM_CONFIG_AUDIT_LEVEL': 'low',
        'NPM_CONFIG_UPDATE_NOTIFIER': 'false', 'NPM_CONFIG_FUND': 'false',
        'NPM_CONFIG_FETCH_RETRIES': '0', 'NPM_CONFIG_FETCH_TIMEOUT': '30000'}


def require_tool(argv, runner, **options):
    code, output = runner(argv, **options)
    if code:
        raise ToolFailure()
    return output.strip()


def exact_ignore(git, mirror, revision, work, runner, options):
    if (mirror / '.gitleaksignore').exists() or (mirror / '.gitleaksignore').is_symlink():
        raise ValueError('Ambient scanner policy is forbidden')
    base = [git, '--git-dir', str(mirror)]
    listing = require_tool(base + ['ls-tree', revision, '--', '.gitleaksignore'], runner, **options, limit=2048)
    if not listing:
        return None
    if not re.fullmatch(r'100(?:644|755) blob [a-f0-9]{40}\t\.gitleaksignore', listing):
        raise ValueError('Ignore policy must be a regular file')
    text = require_tool(base + ['show', revision + ':.gitleaksignore'], runner, **options, limit=32768)
    exact = []
    for line in text.splitlines():
        value = line.strip()
        if not value or value.startswith('#'):
            continue
        match = re.fullmatch(r'[a-fA-F0-9]{40}:([^:]+):[A-Za-z0-9][A-Za-z0-9_-]{0,127}:[1-9][0-9]*', value)
        if not match or match[1].startswith(('/', '!', '~')) or any(part in ('', '.', '..') for part in match[1].split('/')) or re.search(r'[\x00-\x1f\x7f*?\[\]{}\\]', match[1]):
            raise ValueError('Only exact reviewed fingerprints are permitted')
        exact.append(value)
    if not exact:
        return None
    destination = work / 'reviewed-ignore'
    write_private(destination, '\n'.join(exact) + '\n')
    return destination


def manifests(git, mirror, revision, destination, runner, options):
    data = {}
    for name, bound in [('package.json', 1024 * 1024), ('package-lock.json', MAX_JSON)]:
        listing = require_tool([git, '--git-dir', str(mirror), 'ls-tree', revision, '--', name], runner, **options, limit=2048)
        if not re.fullmatch(r'100(?:644|755) blob [a-f0-9]{40}\t' + re.escape(name), listing):
            raise ValueError('Only regular JSON manifests may be read')
        text = require_tool([git, '--git-dir', str(mirror), 'show', revision + ':' + name], runner, **options, limit=bound)
        data[name] = json_data(text)
        if not isinstance(data[name], dict):
            raise ValueError('Manifest must be a JSON object')
    package, lock = data['package.json'], data['package-lock.json']
    if package.get('name') != PROJECT_ID or package.get('workspaces') or lock.get('lockfileVersion') not in (2, 3) or not isinstance(lock.get('packages'), dict):
        raise ValueError('Unsupported project or lockfile layout')
    root_metadata = lock['packages'].get('')
    if not isinstance(root_metadata, dict):
        raise ValueError('Lockfile root metadata is required')
    declared = {}
    for key in ('dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'):
        rows = package.get(key, {})
        if not isinstance(rows, dict) or rows != root_metadata.get(key, {}):
            raise ValueError('Invalid dependency metadata')
        for name, spec in rows.items():
            if not NAME.fullmatch(name) or not isinstance(spec, str) or not re.fullmatch(r'[0-9A-Za-z<>=~^*|+. -]+', spec):
                raise ValueError('Only public registry dependency metadata is supported')
            info = lock['packages'].get('node_modules/' + name, {})
            version = info.get('version') if isinstance(info, dict) else None
            if not isinstance(version, str) or not VERSION.fullmatch(version) or info.get('link'):
                raise ValueError('Declared dependency must have a locked registry version')
            declared[name] = version
    if len(declared) > 512:
        raise ValueError('Too many declared dependencies for the bounded native check')
    for path, row in lock['packages'].items():
        if (not isinstance(row, dict) or row.get('link') or '\\' in path
                or any(part == '..' for part in path.split('/')) or path and not path.startswith('node_modules/')):
            raise ValueError('Linked or external filesystem dependencies are unsupported')
    destination.mkdir(mode=0o700)
    # Copy data only. No repository .npmrc, JS, hooks, source or executable is extracted.
    for name, value in data.items():
        write_private(destination / name, json.dumps(value))
    return declared


def metadata_stubs(destination, declared):
    # npm outdated reads an actual tree and otherwise omits missing dev packages.
    # These inert JSON-only stubs supply locked direct versions, not installed code.
    for name, version in declared.items():
        directory = destination / 'node_modules' / name
        directory.mkdir(mode=0o700, parents=True)
        write_private(directory / 'package.json', json.dumps({'name': name, 'version': version}))


def audit_result(code, output, production):
    name, category = ('Native locked production audit', 'audit-prod') if production else ('Native locked full audit', 'audit-full')
    try:
        data = json_data(output)
        counts = data['metadata']['vulnerabilities']
        keys = ('info', 'low', 'moderate', 'high', 'critical', 'total')
        if (code not in (0, 1) or not isinstance(data.get('vulnerabilities'), dict)
                or not all(type(counts.get(key)) is int and 0 <= counts[key] <= 2**53 - 1 for key in keys)
                or counts['total'] != sum(counts[key] for key in keys[:-1]) or code == 1 and counts['total'] == 0):
            raise ValueError()
        status = 'fail' if counts['high'] or counts['critical'] else 'warn' if counts['total'] else 'pass'
        return check(name, category, status, exit_code=code, **{key: counts[key] for key in keys})
    except (ValueError, TypeError, KeyError, AttributeError):
        return check(name, category, 'fail', errors=1, invalid_report=True)


def outdated_result(code, output, declared):
    try:
        data = json_data(output)
        if code not in (0, 1) or not isinstance(data, dict) or code == 1 and not data:
            raise ValueError()
        for name, row in data.items():
            if (name not in declared or not isinstance(row, dict) or row.get('current') != declared[name]
                    or any(not isinstance(row.get(key), str) or not VERSION.fullmatch(row[key]) for key in ('wanted', 'latest'))):
                raise ValueError()
        return check('Native declared dependency updates from locked versions', 'outdated', 'warn' if data else 'pass', exit_code=code, packages=len(data))
    except (ValueError, TypeError, AttributeError):
        return check('Native declared dependency updates from locked versions', 'outdated', 'fail', errors=1, invalid_report=True)


def run_native(root, runner=capture):
    root = prepare_runtime(runtime_root(root))
    checks = blocked_runtime_checks()
    revision = None
    completed = set()
    try:
        tools = tools_for(root)
        with site_lock(root / 'locks/native-repository.lock'), tempfile.TemporaryDirectory(prefix='native-enztronic-', dir=root) as temporary:
            work = Path(temporary)
            env = anonymous_environment(work, root, tools)
            options = {'cwd': work, 'env': env, 'timeout': 180}
            mirror = root / 'mirrors/enztronic-native.git'
            reject_reparse(mirror)
            if mirror.is_symlink():
                raise ValueError('Unsafe public mirror')
            git = tools['git']
            if mirror.exists():
                origin = require_tool([git, '--git-dir', str(mirror), 'config', '--get', 'remote.origin.url'], runner, **options, limit=1024)
                if origin != REPOSITORY_URL:
                    raise ValueError('Unexpected public mirror origin')
                require_tool([git, '--git-dir', str(mirror), 'fetch', 'origin', '+refs/heads/main:refs/heads/main'], runner, **options)
            else:
                require_tool([git, 'clone', '--bare', '--single-branch', '--branch', 'main', REPOSITORY_URL, str(mirror)], runner, **options)
            revision = require_tool([git, '--git-dir', str(mirror), 'rev-parse', 'refs/heads/main'], runner, **options, limit=128)
            if not re.fullmatch(r'[a-f0-9]{40}', revision):
                raise ValueError('Invalid public source revision')
            ignore = exact_ignore(git, mirror, revision, work, runner, options)
            report = work / 'redacted-findings.json'
            scanner = [tools['gitleaks'], 'git', '--no-banner', '--redact=100', '--report-format', 'json', '--report-path', str(report), '--log-opts=refs/heads/main']
            if ignore:
                scanner += ['--gitleaks-ignore-path', str(ignore)]
            scanner.append(str(mirror))
            code, _ = runner(scanner, **{**options, 'timeout': 600}, limit=1024 * 1024)
            findings = json_data(report.read_text(encoding='utf-8')) if report.exists() and report.stat().st_size <= MAX_JSON else None
            if code not in (0, 1) or not isinstance(findings, list) or any(not isinstance(row, dict) for row in findings):
                checks.append(check('Native redacted Git history scan', 'gitleaks', 'fail', errors=1, scanner_failed=True))
            else:
                checks.append(check('Native redacted Git history scan', 'gitleaks', 'fail' if code or findings else 'pass', findings=len(findings), history_scanned=True))
            completed.add('gitleaks')
            project = work / 'metadata'
            declared = manifests(git, mirror, revision, project, runner, options)
            npm = [tools['node'], tools['npm_cli']]
            # Workspaces were rejected above. npm10's --workspaces=false filters
            # inert actual trees and can otherwise hide every direct update.
            flags = ['--json', '--ignore-scripts', '--registry=' + REGISTRY, '--fetch-retries=0', '--fetch-timeout=30000']
            npm_options = {'cwd': project, 'env': env, 'timeout': 180}
            for production, category in [(True, 'audit-prod'), (False, 'audit-full')]:
                code, output = runner(npm + ['audit', '--package-lock-only', *(['--omit=dev'] if production else []), *flags], **npm_options)
                checks.append(audit_result(code, output, production))
                completed.add(category)
            metadata_stubs(project, declared)
            code, output = runner(npm + ['outdated', '--all', *flags], **npm_options)
            checks.append(outdated_result(code, output, declared))
            completed.add('outdated')
    except Exception as error:
        flag = error.flag if isinstance(error, ToolFailure) else 'execution_error'
        checks.append(check('Native metadata verification setup', 'setup', 'fail', errors=1, **{flag: True}))
    for category in ('gitleaks', 'audit-prod', 'audit-full', 'outdated'):
        if category not in completed:
            checks.append(check('Native ' + category + ' did not complete', category, 'blocked', errors=1, prerequisites_failed=True))
    document = {'repository': PROJECT_ID, 'checks': checks}
    if revision and re.fullmatch(r'[a-f0-9]{40}', revision):
        document['revision'] = revision
    return document


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--root', required=True)
    args = parser.parse_args(argv)
    try:
        document = run_native(args.root)
    except Exception:
        document = {'repository': PROJECT_ID, 'checks': blocked_runtime_checks() + [check('Native private root unavailable', 'setup', 'fail', errors=1, execution_error=True)]}
    print(json.dumps(document))
    return 1  # Native mode deliberately cannot satisfy isolated full coverage.


if __name__ == '__main__':
    raise SystemExit(main())
