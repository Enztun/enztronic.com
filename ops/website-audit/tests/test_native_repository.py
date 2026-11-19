"""Metadata-only fixtures; no Git/pnpm/registry/scanner/browser/production calls."""
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
    # pnpm audit --json: one advisory per finding, summary counts without a total.
    advisories = {str(index): {'severity': severity, 'module_name': 'fixture'}
                  for index, severity in enumerate(['high'] * high + ['moderate'] * moderate)}
    return json.dumps({'advisories': advisories, 'metadata': {'vulnerabilities': {'info': 0, 'low': 0,
                       'moderate': moderate, 'high': high, 'critical': 0}, 'dependencies': 2}})


PACKAGE = {'name': 'enztronic', 'version': '0.1.0', 'packageManager': 'pnpm@0.0.1-fixture',
           'scripts': {'postinstall': 'NEVER_EXECUTE_FIXTURE_SOURCE'},
           'dependencies': {'example': '^1'}, 'devDependencies': {'@types/example': '^2'}}
LOCK = """lockfileVersion: '9.0'

settings:
  autoInstallPeers: true
  excludeLinksFromLockfile: false

overrides:
  postcss: 8.5.30

importers:

  .:
    dependencies:
      example:
        specifier: ^1
        version: 1.0.0
    devDependencies:
      '@types/example':
        specifier: ^2
        version: 2.0.0(example@1.0.0)

packages:

  '@types/example@2.0.0':
    resolution: {integrity: sha512-QUFBQQ==}
    peerDependencies:
      example: ^1

  example@1.0.0:
    resolution: {integrity: sha512-QkJCQg==}
    engines: {node: '>=18'}

snapshots:

  '@types/example@2.0.0(example@1.0.0)':
    dependencies:
      example: 1.0.0
      example-alias: example@1.0.0
    transitivePeerDependencies:
      - supports-color

  example@1.0.0: {}
"""


class NativeParsers(unittest.TestCase):
    def test_real_pnpm_audit_shapes_preserve_counts_and_severity(self):
        for high, moderate, expected in [(10, 7, 'fail'), (0, 7, 'warn'), (0, 0, 'pass')]:
            row = native.audit_result(1 if high + moderate else 0, audit_json(high, moderate), True)
            self.assertEqual(row['status'], expected)
            self.assertEqual(row['metrics']['total'], high + moderate)

    def test_error_json_malformed_duplicate_and_contradictory_audits_cannot_pass(self):
        malformed = json.loads(audit_json())
        malformed['metadata']['vulnerabilities']['high'] = True
        understated = json.loads(audit_json(high=2))
        understated['metadata']['vulnerabilities']['high'] = 1
        unknown = json.loads(audit_json(high=1))
        unknown['advisories']['0']['severity'] = 'fixture-private'
        for code, text in [(1, '{"error":{"detail":"fixture-private"}}'), (0, 'not-json'),
                           (2, audit_json()), (1, audit_json()), (0, json.dumps(malformed)),
                           (1, json.dumps(understated)), (1, json.dumps(unknown)),
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
    def run_fixture(self, *, package=PACKAGE, lock=LOCK, ignore=None, corrupt_audit=False, origin=None):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            for name in ('bin', 'cache', 'locks', 'mirrors'):
                (root / name).mkdir()
            if origin:
                (root / 'mirrors/enztronic-native.git').mkdir()
            calls, extracted = [], []
            tools = {'git': 'C:/tools/git.exe', 'node': 'C:/tools/node.exe', 'pnpm_cli': 'C:/tools/pnpm.mjs', 'gitleaks': 'C:/tools/gitleaks.exe'}

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
                        self.assertIn(name, ('package.json', 'pnpm-lock.yaml', '.gitleaksignore'))
                        if name == '.gitleaksignore':
                            return 0, ignore
                        return 0, json.dumps(package) if name == 'package.json' else lock
                    return 0, ''
                if args[0] == tools['gitleaks']:
                    self.assertIn('--redact=100', args)
                    Path(args[args.index('--report-path') + 1]).write_text('[]', encoding='utf-8')
                    if ignore:
                        path = Path(args[args.index('--gitleaks-ignore-path') + 1])
                        self.assertEqual(path.read_text(encoding='utf-8').strip(), ignore)
                    return 0, ''
                self.assertEqual(args[:2], [tools['node'], tools['pnpm_cli']])
                self.assertIn(args[2], ('audit', 'outdated'))
                npmrc = (Path(options['env']['HOME']) / '.npmrc').read_text(encoding='utf-8')
                self.assertIn('registry=https://registry.npmjs.org/', npmrc)
                self.assertIn('ignore-scripts=true', npmrc)
                cwd = options['cwd']
                extracted[:] = sorted(path.relative_to(cwd).as_posix() for path in cwd.rglob('*') if path.is_file())
                inert = json.loads((cwd / 'package.json').read_text(encoding='utf-8'))
                self.assertEqual(set(inert), {'name', 'version', 'dependencies', 'devDependencies'})
                self.assertEqual((cwd / 'pnpm-lock.yaml').read_text(encoding='utf-8'), lock)
                if args[2] == 'audit':
                    self.assertEqual(extracted, ['package.json', 'pnpm-lock.yaml', 'pnpm-workspace.yaml'])
                    self.assertIn('--json', args)
                    self.assertIn('--registry=https://registry.npmjs.org/', args)
                    return (1, '{"error":{"detail":"fixture-private"}}') if corrupt_audit else (0, audit_json())
                self.assertEqual(args[3:], ['--format', 'json'])
                self.assertEqual((cwd / 'node_modules/.pnpm/lock.yaml').read_text(encoding='utf-8'), lock)
                return 1, json.dumps({'example': {'current': '1.0.0', 'wanted': '1.0.1', 'latest': '2.0.0',
                                                  'isDeprecated': False, 'dependencyType': 'dependencies'}})

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

    def test_full_native_flow_only_reads_two_manifests_and_inert_lock_copy(self):
        document, calls, extracted = self.run_fixture()
        self.assertEqual(document['revision'], 'a' * 40)
        self.assertEqual({row['category'] for row in document['checks']}, {'gitleaks', 'audit-prod', 'audit-full', 'outdated', 'lint', 'typecheck', 'unit', 'build'})
        for row in document['checks']:
            if row['category'] in ('lint', 'typecheck', 'unit', 'build'):
                self.assertEqual(row['status'], 'blocked')
            if row['category'] in ('audit-prod', 'audit-full', 'outdated'):
                self.assertIn(row['status'], ('pass', 'warn'))
        self.assertIn('node_modules/.pnpm/lock.yaml', extracted)
        self.assertNotIn('fixture-private', json.dumps(document))
        self.assertFalse(any(word in args for args, _env in calls for word in ('install', 'add', 'ci', 'run', 'exec', 'dlx', 'build')))
        audits = [args for args, _env in calls if len(args) > 2 and args[2] == 'audit']
        self.assertEqual([('--prod' in args) for args in audits], [True, False])

    def test_exact_head_ignore_is_applied_and_wildcard_ignore_fails_closed(self):
        exact = 'a' * 40 + ':src/fixture.ts:generic-api-key:19'
        document, _calls, _files = self.run_fixture(ignore=exact)
        self.assertTrue(any(row['category'] == 'gitleaks' and row['status'] == 'pass' for row in document['checks']))
        document, calls, _files = self.run_fixture(ignore='a' * 40 + ':src/*:generic-api-key:19')
        self.assertTrue(any(row['category'] == 'setup' and row['status'] == 'fail' for row in document['checks']))
        self.assertFalse(any(args[0].endswith('gitleaks.exe') for args, _env in calls))

    def test_identity_mismatch_workspaces_and_lock_drift_never_reach_pnpm(self):
        drifted = LOCK.replace('specifier: ^1\n', 'specifier: ^9\n')
        for options in [{'origin': 'https://outside.example/project.git'}, {'package': {**PACKAGE, 'workspaces': ['../../private']}},
                        {'lock': drifted}, {'lock': LOCK.replace("'9.0'", "'6.0'")}]:
            document, calls, _files = self.run_fixture(**options)
            self.assertFalse(any(args[0].endswith('node.exe') for args, _env in calls))
            self.assertTrue(any(row['category'] == 'setup' and row['status'] == 'fail' for row in document['checks']))

    def test_bad_pnpm_json_fails_without_copying_error_details(self):
        document, _calls, _files = self.run_fixture(corrupt_audit=True)
        self.assertTrue(all(row['status'] == 'fail' for row in document['checks'] if row['category'].startswith('audit-')))
        self.assertNotIn('fixture-private', json.dumps(document))


class NativeLockfile(unittest.TestCase):
    def test_registry_lockfile_returns_locked_direct_versions(self):
        importer = native.pnpm_lock(LOCK)
        self.assertEqual(importer, {'dependencies': {'example': ('^1', '1.0.0')},
                                    'devDependencies': {'@types/example': ('^2', '2.0.0')}})

    def test_links_files_tarballs_git_and_workspaces_fail_closed(self):
        unsafe = [
            LOCK.replace('version: 1.0.0\n    devDependencies', 'version: link:../private\n    devDependencies'),
            LOCK.replace('example: 1.0.0\n      example-alias', 'example: file:../private.tgz\n      example-alias'),
            LOCK.replace('resolution: {integrity: sha512-QkJCQg==}', 'resolution: {tarball: https://outside.example/x.tgz}'),
            LOCK.replace('resolution: {integrity: sha512-QkJCQg==}', 'resolution: {type: git, repo: https://outside.example/x}'),
            LOCK.replace('resolution: {integrity: sha512-QkJCQg==}', 'resolution: {directory: ../private, type: directory}'),
            LOCK.replace('  example@1.0.0:\n    resolution', '  example@file:../private:\n    resolution'),
            LOCK.replace('importers:\n\n  .:', 'importers:\n\n  packages/private:\n    dependencies:\n      x:\n        specifier: ^1\n        version: 1.0.0\n\n  .:'),
            LOCK.replace('    devDependencies:', '    dependenciesMeta:\n      example:\n        injected: true\n    devDependencies:'),
            LOCK.replace('overrides:\n  postcss: 8.5.30', 'overrides:\n  postcss: link:../private'),
            LOCK + 'patchedDependencies:\n  example: patches/example.patch\n',
            LOCK.replace('  example@1.0.0:\n    resolution', '  example@1.0.0:\n    resolution: {integrity: sha512-QkJCQg==}\n    resolution'),
            LOCK.replace('specifier: ^1\n', 'specifier: "^1"\n'),
            LOCK.replace('  .:', '\t.:'),
        ]
        for text in unsafe:
            with self.subTest(text=text[-80:]):
                with self.assertRaises(ValueError):
                    native.pnpm_lock(text)


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
            for key, name in [('git', 'git.exe'), ('node', 'node.exe'), ('pnpm_cli', 'pnpm.mjs')]:
                path = root / name
                path.write_bytes(b'fixture trusted tool')
                paths[key] = str(path)
            (root / 'bin/tool-paths.json').write_text(json.dumps(paths), encoding='utf-8')
            (root / 'bin/gitleaks.exe').write_bytes(b'fixture scanner')
            checksum = root / 'bin/gitleaks.sha256'
            checksum.write_text(hashlib.sha256(b'fixture scanner').hexdigest(), encoding='ascii')
            self.assertEqual(set(native.tools_for(root)), {'git', 'node', 'pnpm_cli', 'gitleaks'})
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
