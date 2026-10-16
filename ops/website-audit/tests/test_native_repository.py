"""Metadata-only fixtures; no Git/npm/registry/scanner/browser/production calls."""
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time
from types import SimpleNamespace
import unittest
from unittest import mock

FOLDER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FOLDER))
SPEC = importlib.util.spec_from_file_location('native_repository_fixture', FOLDER / 'native_repository.py')
native = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(native)


def audit_json(high=0, moderate=0):
    return json.dumps({'metadata': {'vulnerabilities': {'info': 0, 'low': 0, 'moderate': moderate,
                       'high': high, 'critical': 0, 'total': high + moderate}}, 'vulnerabilities': {}})


PACKAGE = {'name': 'enztronic', 'version': '0.1.0', 'scripts': {'postinstall': 'NEVER_EXECUTE_FIXTURE_SOURCE'},
           'dependencies': {'example': '^1'}, 'devDependencies': {'@types/example': '^2'}}
LOCK = {'lockfileVersion': 3, 'packages': {'': {key: value for key, value in PACKAGE.items() if key != 'scripts'},
        'node_modules/example': {'version': '1.0.0'}, 'node_modules/@types/example': {'version': '2.0.0', 'dev': True}}}


class NativeParsers(unittest.TestCase):
    def test_real_npm_audit_shapes_preserve_counts_and_severity(self):
        for high, moderate, expected in [(10, 7, 'fail'), (0, 7, 'warn'), (0, 0, 'pass')]:
            row = native.audit_result(1 if high + moderate else 0, audit_json(high, moderate), True)
            self.assertEqual(row['status'], expected)
            self.assertEqual(row['metrics']['total'], high + moderate)

    def test_error_json_malformed_duplicate_and_contradictory_audits_cannot_pass(self):
        malformed = json.loads(audit_json())
        malformed['metadata']['vulnerabilities']['high'] = True
        for code, text in [(1, '{"error":{"detail":"fixture-private"}}'), (0, 'not-json'),
                           (2, audit_json()), (1, audit_json()), (0, json.dumps(malformed)),
                           (0, '{"metadata":{},"metadata":{}}')]:
            row = native.audit_result(code, text, False)
            self.assertEqual(row['status'], 'fail')
            self.assertNotIn('fixture-private', json.dumps(row))

    def test_outdated_requires_current_locked_versions_and_valid_rows(self):
        declared = {'example': '1.0.0'}
        row = {'example': {'current': '1.0.0', 'wanted': '1.0.1', 'latest': '2.0.0'}}
        self.assertEqual(native.outdated_result(1, json.dumps(row), declared)['metrics']['packages'], 1)
        self.assertEqual(native.outdated_result(0, '{}', declared)['status'], 'pass')
        for output in [{'error': {'detail': 'fixture-private'}}, {'example': {'wanted': '1.0.1', 'latest': '2.0.0'}},
                       {'example': {'current': '9.0.0', 'wanted': '1.0.1', 'latest': '2.0.0'}}, []]:
            result = native.outdated_result(1, json.dumps(output), declared)
            self.assertEqual(result['status'], 'fail')
            self.assertNotIn('fixture-private', json.dumps(result))


class NativeFlow(unittest.TestCase):
    def run_fixture(self, *, package=PACKAGE, ignore=None, corrupt_audit=False, origin=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bin', 'cache', 'locks', 'mirrors'):
                (root / name).mkdir()
            if origin:
                (root / 'mirrors/enztronic-native.git').mkdir()
            calls, extracted = [], []
            tools = {'git': 'C:/tools/git.exe', 'node': 'C:/tools/node.exe', 'npm_cli': 'C:/tools/npm-cli.js', 'gitleaks': 'C:/tools/gitleaks.exe'}

            def runner(argv, **options):
                args = [str(item) for item in argv]
                calls.append((args, options['env'].copy()))
                self.assertNotIn('DISCORD_WEBHOOK_URL', options['env'])
                self.assertNotIn('NPM_TOKEN', options['env'])
                self.assertNotIn('NODE_OPTIONS', options['env'])
                if args[0] == tools['git']:
                    if 'clone' in args:
                        self.assertIn('https://github.com/enztun/enztronic.com.git', args)
                        self.assertNotIn('--depth', args)
                    if 'config' in args:
                        return 0, origin or native.REPOSITORY_URL
                    if 'rev-parse' in args:
                        return 0, 'a' * 40
                    if 'ls-tree' in args:
                        name = args[-1]
                        if name == '.gitleaksignore' and ignore is None:
                            return 0, ''
                        return 0, '100644 blob ' + 'b' * 40 + '\t' + name
                    if 'show' in args:
                        name = args[-1].split(':', 1)[1]
                        self.assertIn(name, ('package.json', 'package-lock.json', '.gitleaksignore'))
                        if name == '.gitleaksignore':
                            return 0, ignore
                        return 0, json.dumps(package if name == 'package.json' else LOCK)
                    return 0, ''
                if args[0] == tools['gitleaks']:
                    self.assertIn('--redact=100', args)
                    Path(args[args.index('--report-path') + 1]).write_text('[]', encoding='utf-8')
                    if ignore:
                        path = Path(args[args.index('--gitleaks-ignore-path') + 1])
                        self.assertEqual(path.read_text(encoding='utf-8').strip(), ignore)
                    return 0, ''
                self.assertEqual(args[:2], [tools['node'], tools['npm_cli']])
                self.assertIn(args[2], ('audit', 'outdated'))
                self.assertIn('--ignore-scripts', args)
                self.assertIn('--registry=https://registry.npmjs.org/', args)
                cwd = options['cwd']
                extracted[:] = sorted(path.relative_to(cwd).as_posix() for path in cwd.rglob('*') if path.is_file())
                self.assertTrue(all(path.endswith('package.json') or path == 'package-lock.json' for path in extracted))
                if args[2] == 'audit':
                    self.assertEqual(extracted, ['package-lock.json', 'package.json'])
                    self.assertIn('--package-lock-only', args)
                    return (1, '{"error":{"detail":"fixture-private"}}') if corrupt_audit else (0, audit_json())
                self.assertEqual(json.loads((cwd / 'node_modules/@types/example/package.json').read_text())['version'], '2.0.0')
                return 1, json.dumps({'example': {'current': '1.0.0', 'wanted': '1.0.1', 'latest': '2.0.0'}})

            with contextlib.ExitStack() as stack:
                stack.enter_context(mock.patch.object(native, 'prepare_runtime', side_effect=lambda path: path))
                stack.enter_context(mock.patch.object(native, 'tools_for', return_value=tools))
                stack.enter_context(mock.patch.dict(os.environ, {'DISCORD_WEBHOOK_URL': 'fixture-private', 'NPM_TOKEN': 'fixture-private', 'NODE_OPTIONS': '--require=evil.js'}))
                if os.name == 'nt':
                    import windows_support
                    stack.enter_context(mock.patch.object(windows_support, 'secure_private_file'))
                document = native.run_native(root, runner)
            self.assertEqual(list(root.glob('native-enztronic-*')), [])
        return document, calls, extracted

    def test_full_native_flow_only_reads_two_manifests_and_inert_version_stubs(self):
        document, calls, extracted = self.run_fixture()
        self.assertEqual(document['revision'], 'a' * 40)
        self.assertEqual({row['category'] for row in document['checks']}, {'gitleaks', 'audit-prod', 'audit-full', 'outdated', 'lint', 'typecheck', 'unit', 'build'})
        for row in document['checks']:
            if row['category'] in ('lint', 'typecheck', 'unit', 'build'):
                self.assertEqual(row['status'], 'blocked')
        self.assertIn('node_modules/@types/example/package.json', extracted)
        self.assertNotIn('fixture-private', json.dumps(document))
        self.assertFalse(any('install' in args or 'ci' in args or 'run' in args or 'build' in args for args, _env in calls))
        self.assertEqual(len([args for args, _env in calls if len(args) > 2 and args[2] == 'audit']), 2)

    def test_exact_head_ignore_is_applied_and_wildcard_ignore_fails_closed(self):
        exact = 'a' * 40 + ':src/fixture.ts:generic-api-key:19'
        document, _calls, _files = self.run_fixture(ignore=exact)
        self.assertTrue(any(row['category'] == 'gitleaks' and row['status'] == 'pass' for row in document['checks']))
        document, calls, _files = self.run_fixture(ignore='a' * 40 + ':src/*:generic-api-key:19')
        self.assertTrue(any(row['category'] == 'setup' and row['status'] == 'fail' for row in document['checks']))
        self.assertFalse(any(args[0].endswith('gitleaks.exe') for args, _env in calls))

    def test_identity_mismatch_and_workspace_paths_never_reach_npm(self):
        for options in [{'origin': 'https://outside.example/project.git'}, {'package': {**PACKAGE, 'workspaces': ['../../private']}}]:
            document, calls, _files = self.run_fixture(**options)
            self.assertFalse(any(args[0].endswith('node.exe') for args, _env in calls))
            self.assertTrue(any(row['category'] == 'setup' and row['status'] == 'fail' for row in document['checks']))

    def test_bad_npm_json_fails_without_copying_error_details(self):
        document, _calls, _files = self.run_fixture(corrupt_audit=True)
        self.assertTrue(all(row['status'] == 'fail' for row in document['checks'] if row['category'].startswith('audit-')))
        self.assertNotIn('fixture-private', json.dumps(document))


class NativeBoundaries(unittest.TestCase):
    def test_native_environment_has_only_private_config_and_no_inherited_credentials(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            with mock.patch.object(native, 'write_private', side_effect=lambda path, content: path.write_text(content, encoding='utf-8')):
                env = native.anonymous_environment(root, root, {'git': 'C:/tools/git.exe', 'node': 'C:/tools/node.exe'})
            self.assertEqual(env['HOME'], str(root / 'home'))
            self.assertEqual(env['NPM_CONFIG_IGNORE_SCRIPTS'], 'true')
            self.assertEqual(env['GIT_CONFIG_VALUE_0'], '')
            self.assertEqual(env['NPM_CONFIG_REGISTRY'], native.REGISTRY)
            self.assertFalse(any(key in env for key in ('NODE_OPTIONS', 'HTTPS_PROXY', 'NPM_TOKEN', 'GITHUB_TOKEN', 'DISCORD_WEBHOOK_URL')))

    def test_tools_require_exact_manifest_and_matching_scanner_binary_hash(self):
        import hashlib
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(native, 'private_file'):
            root = Path(temporary)
            (root / 'bin').mkdir()
            paths = {}
            for key, name in [('git', 'git.exe'), ('node', 'node.exe'), ('npm_cli', 'npm-cli.js')]:
                path = root / name
                path.write_bytes(b'fixture trusted tool')
                paths[key] = str(path)
            (root / 'bin/tool-paths.json').write_text(json.dumps(paths), encoding='utf-8')
            (root / 'bin/gitleaks.exe').write_bytes(b'fixture scanner')
            checksum = root / 'bin/gitleaks.sha256'
            checksum.write_text(hashlib.sha256(b'fixture scanner').hexdigest(), encoding='ascii')
            self.assertEqual(set(native.tools_for(root)), {'git', 'node', 'npm_cli', 'gitleaks'})
            checksum.write_text('0' * 64, encoding='ascii')
            with self.assertRaises(ValueError):
                native.tools_for(root)

    def test_owned_timeout_and_output_overflow_never_return_partial_payload_as_success(self):
        with tempfile.TemporaryDirectory() as temporary:
            began = time.monotonic()
            with self.assertRaises(native.ToolFailure) as error:
                native.capture([sys.executable, '-c', 'import time;time.sleep(30)'], cwd=temporary, env=os.environ.copy(), timeout=0.1)
            self.assertEqual(error.exception.flag, 'timed_out')
            self.assertLess(time.monotonic() - began, 6)
            with self.assertRaises(native.ToolFailure) as error:
                native.capture([sys.executable, '-c', "print('fixture-private'*10000)"], cwd=temporary, env=os.environ.copy(), limit=10)
            self.assertEqual(error.exception.flag, 'output_limit')
            self.assertNotIn('fixture-private', str(error.exception))

    @unittest.skipUnless(os.name == 'nt', 'Windows process tree flags')
    def test_windows_tree_kill_is_hidden_and_targets_only_the_owned_pid(self):
        process = SimpleNamespace(pid=87654, poll=lambda: None)
        with mock.patch.object(native.subprocess, 'run', return_value=SimpleNamespace(returncode=0)) as run:
            native.kill_owned_tree(process)
        args = run.call_args.args[0]
        self.assertEqual(args[-4:], ['/PID', '87654', '/T', '/F'])
        self.assertTrue(args[0].lower().endswith('system32\\taskkill.exe') or args[0].lower().endswith('system32/taskkill.exe'))
        self.assertTrue(run.call_args.kwargs['creationflags'] & subprocess.CREATE_NO_WINDOW)


if __name__ == '__main__':
    unittest.main()
