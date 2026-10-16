"""Windows entrypoint/ACL fixtures; no tasks, credentials, network or app builds."""
import contextlib
import importlib
import io
import json
import os
from pathlib import Path
import stat
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

FOLDER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FOLDER))
windows = importlib.import_module('windows_support')
config = importlib.import_module('runner_config')
entry = importlib.import_module('run')
launcher = importlib.import_module('scheduled_run')


class WindowsPathTests(unittest.TestCase):
    def test_default_is_local_appdata_namespaced_and_missing_value_fails(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ, {'LOCALAPPDATA': temporary}):
            self.assertEqual(windows.default_runtime_root(), Path(temporary) / 'EnztronicAudit')
        with mock.patch.dict(os.environ, {'LOCALAPPDATA': ''}):
            with self.assertRaises(ValueError):
                windows.default_runtime_root()

    def test_reparse_attributes_are_rejected_before_any_creation(self):
        metadata = SimpleNamespace(st_mode=stat.S_IFDIR, st_file_attributes=0x400)
        with mock.patch.object(Path, 'lstat', return_value=metadata), mock.patch.object(Path, 'mkdir') as create:
            with self.assertRaises(ValueError):
                windows.ensure_private_directory(Path(tempfile.gettempdir()) / 'fixture-junction/child')
        create.assert_not_called()

    @unittest.skipUnless(os.name == 'nt', 'Windows path semantics')
    def test_broad_unc_device_and_git_roots_are_rejected(self):
        local = Path(os.environ['LOCALAPPDATA'])
        for path in [Path(Path.cwd().anchor), Path.home(), local, Path('\\\\server\\share\\audit'),
                     local / 'NUL', local / 'name:stream', local / 'trailing.', FOLDER / 'private-runtime']:
            with self.subTest(path=str(path)), self.assertRaises(ValueError):
                config.runtime_root(path)

    @unittest.skipUnless(os.name == 'nt', 'Windows secret metadata dispatch')
    def test_windows_secret_validation_never_calls_getuid_or_reads_contents(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'secret.env'
            path.write_text('fixture only', encoding='utf-8')
            with mock.patch.object(windows, 'validate_private_file') as validate, \
                    mock.patch.object(config.os, 'getuid', side_effect=AssertionError('POSIX API'), create=True), \
                    mock.patch.object(Path, 'read_text', side_effect=AssertionError('Secret read')):
                config.validate_secret_file(path)
            validate.assert_called_once_with(path)


class WindowsProcessTests(unittest.TestCase):
    def test_acl_call_is_hidden_fixed_script_and_structured_metadata_only(self):
        path = Path(tempfile.gettempdir()) / "literal $() ' fixture"
        completed = SimpleNamespace(returncode=0, stdout='{"ok":true}', stderr='')
        with mock.patch.object(windows, 'is_windows', return_value=True), \
                mock.patch.object(windows, '_powershell_path', return_value=Path('trusted-powershell.exe')), \
                mock.patch.object(windows, 'reject_reparse_path'), \
                mock.patch.object(windows.subprocess, 'run', return_value=completed) as child, \
                mock.patch.dict(os.environ, {'DISCORD_WEBHOOK_URL': 'fixture-private', 'SANITY_API_TOKEN': 'fixture-private'}):
            windows._acl_operation(path, 'validate-file')
        arguments = child.call_args.args[0]
        options = child.call_args.kwargs
        self.assertEqual(arguments[-1], windows.ACL_SCRIPT)
        self.assertNotIn(str(path), windows.ACL_SCRIPT)
        self.assertEqual(json.loads(options['input']), {'path': str(path.resolve()), 'operation': 'validate-file'})
        self.assertEqual(options['creationflags'], 0x08000000)
        self.assertEqual(options['timeout'], 30)
        self.assertNotIn('DISCORD_WEBHOOK_URL', options['env'])
        self.assertNotIn('SANITY_API_TOKEN', options['env'])

    def test_acl_failures_discard_raw_process_output(self):
        completed = SimpleNamespace(returncode=1, stdout='fixture-private', stderr='fixture-private')
        with mock.patch.object(windows, '_powershell_path', return_value=Path('trusted.exe')), \
                mock.patch.object(windows, 'reject_reparse_path'), \
                mock.patch.object(windows.subprocess, 'run', return_value=completed):
            with self.assertRaises(ValueError) as caught:
                windows._acl_operation(Path(tempfile.gettempdir()), 'directory')
        self.assertNotIn('fixture-private', str(caught.exception))

    def test_platform_dispatch_preserves_linux_and_uses_console_python_for_native_child(self):
        root = Path(tempfile.gettempdir()) / 'fixture-root'
        with mock.patch.object(entry.sys, 'platform', 'win32'), mock.patch.object(entry.sys, 'executable', str(root / 'pythonw.exe')):
            command = entry.project_config(root)['commands'][0]['argv']
            self.assertEqual(command, [str(root / 'python.exe'), str(FOLDER / 'native_repository.py'), '--root', str(root)])
        with mock.patch.object(entry.sys, 'platform', 'linux'), mock.patch.object(entry.sys, 'executable', '/usr/bin/python3'):
            command = entry.project_config(root)['commands'][0]['argv']
            self.assertEqual(command, ['/usr/bin/python3', str(FOLDER / 'repository_check.py'), '--root', str(root)])


class ScheduledLauncherTests(unittest.TestCase):
    def test_pythonw_none_streams_and_actual_exit_codes_without_raw_logs(self):
        root = Path(tempfile.gettempdir()) / 'fixture-root'
        for code in [0, 1, 2, 75]:
            def run(_argv):
                print('fixture-private stdout')
                print('fixture-private stderr', file=sys.stderr)
                return code
            with mock.patch.object(launcher, 'runtime_root', return_value=root), \
                    mock.patch.object(launcher, 'prepare_runtime', return_value=root), \
                    mock.patch.object(launcher.audit, 'site_lock', return_value=contextlib.nullcontext()), \
                    mock.patch.object(launcher, '_append_log') as log, \
                    mock.patch.object(launcher.run, 'main', side_effect=run), \
                    mock.patch.object(sys, 'stdout', None), mock.patch.object(sys, 'stderr', None):
                actual = launcher.main(['--root', str(root), '--mode', 'due'])
            self.assertEqual(actual, code)
            self.assertEqual([call.args[1] for call in log.call_args_list], ['started', f'completed exit_code={code}'])
            self.assertNotIn('fixture-private', str(log.call_args_list))

    def test_unexpected_error_is_only_fixed_failure_code(self):
        root = Path(tempfile.gettempdir()) / 'fixture-root'
        with mock.patch.object(launcher, 'runtime_root', return_value=root), \
                mock.patch.object(launcher, 'prepare_runtime', return_value=root), \
                mock.patch.object(launcher.audit, 'site_lock', return_value=contextlib.nullcontext()), \
                mock.patch.object(launcher, '_append_log') as log, \
                mock.patch.object(launcher.run, 'main', side_effect=RuntimeError('fixture-private')):
            self.assertEqual(launcher.main([]), 2)
        self.assertNotIn('fixture-private', str(log.call_args_list))

    def test_log_rotation_is_bounded_and_contains_only_launcher_status(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            (root / 'state').mkdir()
            path = root / 'state/launcher.log'
            path.write_bytes(b'x' * (launcher.MAX_LOG_BYTES - 1))
            with mock.patch.object(launcher, 'ensure_private_directory'), \
                    mock.patch.object(launcher, 'validate_private_file'), \
                    mock.patch.object(launcher, 'secure_private_file'), \
                    mock.patch.object(launcher, 'reject_reparse_path'):
                launcher._append_log(root, 'completed exit_code=75')
            self.assertLess(path.stat().st_size, launcher.MAX_LOG_BYTES)
            self.assertIn('completed exit_code=75', path.read_text(encoding='ascii'))
            self.assertEqual(path.with_name('launcher.log.1').stat().st_size, launcher.MAX_LOG_BYTES - 1)


@unittest.skipUnless(os.name == 'nt', 'Actual local NTFS fixture')
class ActualNtfsTests(unittest.TestCase):
    def test_actual_owner_acl_inheritance_and_rejection_of_everyone(self):
        # These are disposable fixture paths only, never runtime/bootstrap files.
        with tempfile.TemporaryDirectory(prefix='enz-ntfs-test-') as temporary:
            root = Path(temporary) / 'private'
            windows.ensure_private_directory(root)
            path = root / 'fixture.txt'
            path.write_text('fixture only', encoding='ascii')
            windows.validate_private_file(path)
            windows.secure_private_file(path)
            script = r'''
$ErrorActionPreference='Stop'
$path=([Console]::In.ReadToEnd() | ConvertFrom-Json).path
$acl=New-Object Security.AccessControl.FileSecurity
$owner=[Security.Principal.WindowsIdentity]::GetCurrent().User
$acl.SetOwner($owner)
$acl.SetAccessRuleProtection($true,$false)
foreach($identity in @($owner.Value,'S-1-5-18','S-1-5-32-544')) {
  $principal=New-Object Security.Principal.SecurityIdentifier($identity)
  $acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($principal,'FullControl','Allow')))
}
$sid=New-Object Security.Principal.SecurityIdentifier('S-1-1-0')
$acl.AddAccessRule((New-Object Security.AccessControl.FileSystemAccessRule($sid,'Read','Allow')))
(Get-Item -LiteralPath $path).SetAccessControl($acl)
'''
            process = subprocess.run([str(windows._powershell_path()), '-NoProfile', '-NonInteractive', '-Command', script],
                                     input=json.dumps({'path': str(path)}), text=True, capture_output=True,
                                     timeout=30, **windows.hidden_process_options())
            self.assertEqual(process.returncode, 0, 'Fixture ACL setup failed')
            with self.assertRaises(ValueError):
                windows.validate_private_file(path)


if __name__ == '__main__':
    unittest.main()
