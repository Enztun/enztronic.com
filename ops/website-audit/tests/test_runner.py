"""Independent Enztronic runner fixtures: no SSH, Docker, browser or network."""
import base64
import contextlib
import importlib.util
import io
import json
import os
from pathlib import Path
import stat
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock

FOLDER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FOLDER))


def load(name, filename):
    spec = importlib.util.spec_from_file_location(name, FOLDER / filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


config = load('independent_runner_config', 'runner_config.py')
entry = load('independent_runner', 'run.py')
install = load('independent_installer', 'install.py')
repository = load('independent_repository', 'repository_check.py')


class RuntimeTests(unittest.TestCase):
    def test_default_root_is_home_namespaced_and_explicit_root_wins(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(config.Path, 'home', return_value=Path(temporary)):
            with mock.patch.dict(os.environ, {}, clear=True):
                self.assertEqual(config.runtime_root(), Path(temporary).resolve() / '.local/share/enztronic-audit')
            with mock.patch.dict(os.environ, {'ENZTRONIC_AUDIT_ROOT': str(Path(temporary) / 'environment')}):
                self.assertEqual(config.runtime_root(), (Path(temporary) / 'environment').resolve())
                self.assertEqual(config.runtime_root(Path(temporary) / 'explicit'), (Path(temporary) / 'explicit').resolve())

    def test_root_rejects_relative_broad_and_cron_control_paths(self):
        for value in ['relative', Path(Path.cwd().anchor), Path.home(), Path.home() / 'nested/..', Path(Path.cwd().anchor) / 'tmp/..', str(Path.home() / 'unsafe%cron'), str(Path.home() / 'unsafe\ncron')]:
            with self.subTest(value=str(value)), self.assertRaises(ValueError):
                config.runtime_root(value)

    def test_runtime_directories_are_private_and_namespaced(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = config.prepare_runtime(Path(temporary) / 'independent')
            self.assertEqual({path.name for path in root.iterdir()}, {'bin', 'sites', 'state', 'mirrors', 'cache', 'locks', 'secrets'})
            if os.name == 'posix':
                self.assertTrue(all(path.stat().st_mode & 0o777 == 0o700 for path in [root, *root.iterdir()]))

    def test_dotdot_and_parent_symlink_roots_fail_before_any_directory_mutation(self):
        with mock.patch.object(config, 'ensure_private_directory') as mutate:
            for path in [Path.home() / 'nested/..', Path(Path.cwd().anchor) / 'tmp/..']:
                with self.assertRaises(ValueError):
                    config.prepare_runtime(path)
            with mock.patch.object(config.Path, 'is_symlink', autospec=True, side_effect=lambda path: path.name == 'linked'):
                with self.assertRaises(ValueError):
                    config.prepare_runtime(Path.home() / 'linked/private')
        mutate.assert_not_called()

    def test_runtime_cannot_be_a_git_checkout_or_a_child_of_one(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(config, 'ensure_private_directory') as mutate:
            checkout = Path(temporary) / 'checkout'
            checkout.mkdir()
            (checkout / '.git').write_text('fixture worktree marker', encoding='utf-8')
            for path in [checkout, checkout / 'private']:
                with self.assertRaises(ValueError):
                    config.prepare_runtime(path)
        mutate.assert_not_called()

    def test_symlink_guard_precedes_directory_mutation(self):
        path = mock.Mock()
        path.is_symlink.return_value = True
        with self.assertRaises(ValueError):
            config.ensure_private_directory(path)
        path.mkdir.assert_not_called()
        path.chmod.assert_not_called()

    def test_root_cannot_traverse_a_symlink(self):
        with tempfile.TemporaryDirectory() as temporary:
            outside, link = Path(temporary) / 'outside', Path(temporary) / 'linked'
            outside.mkdir()
            try:
                link.symlink_to(outside, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest('OS account cannot create directory symlinks')
            with self.assertRaises(ValueError):
                config.runtime_root(link / 'audit')
            self.assertFalse((outside / 'audit').exists())

    def test_discord_secret_is_metadata_checked_without_reading_values(self):
        path = mock.Mock()
        path.is_symlink.return_value = False
        path.stat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=17)
        with mock.patch.object(config.os, 'getuid', return_value=17, create=True):
            config.validate_secret_file(path)
            path.read_text.assert_not_called()
            for mode, owner in [(0o644, 17), (0o600, 18)]:
                path.stat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | mode, st_uid=owner)
                with self.assertRaises(ValueError):
                    config.validate_secret_file(path)

    def test_public_build_settings_require_representative_values_and_reject_private_keys(self):
        valid = {'NEXT_PUBLIC_SANITY_PROJECT_ID': 'fixture', 'NEXT_PUBLIC_SANITY_DATASET': 'production'}
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'public.json'
            path.write_text(json.dumps(valid), encoding='utf-8')
            self.assertEqual(config.public_build_settings(path), valid)
            for value in [{}, [], {**valid, 'SANITY_API_TOKEN': 'fixture-private'}, {**valid, 'NEXT_PUBLIC_SITE_URL': []}]:
                path.write_text(json.dumps(value), encoding='utf-8')
                with self.assertRaises(ValueError):
                    config.public_build_settings(path)

    def test_only_fixed_public_repository_is_allowed_before_any_tool_runs(self):
        self.assertEqual(repository.REPOSITORY_URL, 'https://github.com/enztun/enztronic.com.git')
        with mock.patch.object(repository, 'capture') as capture, mock.patch.object(repository, 'checked') as checked:
            with self.assertRaises(ValueError):
                repository.audit_repository('another-project')
        capture.assert_not_called()
        checked.assert_not_called()

    def test_anonymous_git_home_refuses_netrc_before_any_git_or_docker_command(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(repository, 'ROOT', Path(temporary)), \
                mock.patch.object(repository, 'pipeline_lock', return_value=contextlib.nullcontext()), \
                mock.patch.object(repository, 'public_build_settings', return_value={}), \
                mock.patch.object(repository, 'checked') as checked:
            home = Path(temporary) / 'cache/anonymous-home'
            home.mkdir(parents=True)
            (home / '.netrc').write_text('fixture private credentials', encoding='utf-8')
            with self.assertRaises(ValueError):
                repository.audit_repository()
        checked.assert_not_called()

    def test_explicit_cli_root_wins_even_when_ambient_root_is_invalid(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.dict(os.environ, {'ENZTRONIC_AUDIT_ROOT': 'invalid-relative'}):
            module = load('independent_repository_override', 'repository_check.py')
            with mock.patch.object(module.sys if hasattr(module, 'sys') else sys, 'argv', ['repository_check.py', '--root', temporary]), \
                    mock.patch.object(module, 'audit_repository', return_value={'checks': [{'status': 'pass'}]}), \
                    contextlib.redirect_stdout(io.StringIO()):
                self.assertEqual(module.main(), 0)
            self.assertEqual(module.ROOT, Path(temporary).resolve())


class EntrypointTests(unittest.TestCase):
    def test_entrypoint_generates_only_own_command_and_private_paths(self):
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            profile = entry.project_config(root)
        self.assertEqual(profile['id'], 'enztronic')
        self.assertEqual(profile['commands'][0]['argv'], [sys.executable, str(FOLDER / 'repository_check.py'), '--root', str(root)])
        self.assertEqual(profile['discord_secret_file'], str(root / 'secrets/discord.env'))
        self.assertIs(profile['host_checks_required'], False)
        self.assertEqual(profile['docker_containers'], [])

    def test_profile_cannot_switch_project_or_add_an_outside_origin(self):
        source = json.loads((FOLDER / 'sites/enztronic.json').read_text(encoding='utf-8'))
        with tempfile.TemporaryDirectory() as temporary:
            folder = Path(temporary)
            (folder / 'sites').mkdir()
            for changed in [{**source, 'id': 'other'}, {**source, 'urls': [{'url': 'https://outside.example/'}]}, {**source, 'commands': []}]:
                (folder / 'sites/enztronic.json').write_text(json.dumps(changed), encoding='utf-8')
                with self.assertRaises(ValueError):
                    entry.project_config(folder, folder)

    def test_cli_uses_own_root_lock_state_and_exact_requested_mode(self):
        with tempfile.TemporaryDirectory() as temporary, mock.patch.object(entry.sys, 'platform', 'linux'), \
                mock.patch.object(entry.audit, 'site_lock', return_value=contextlib.nullcontext()) as lock, \
                mock.patch.object(entry.audit, 'run_site', return_value=({'status': 'pass', 'discord': 'disabled'}, 0)) as run, \
                contextlib.redirect_stdout(io.StringIO()):
            root = Path(temporary) / 'separate'
            self.assertEqual(entry.main(['--root', str(root), '--mode', 'daily', '--no-discord']), 0)
            self.assertEqual(lock.call_args.args, (root / 'locks/scheduler.lock',))
            self.assertEqual(run.call_args.args[1:], (root / 'state', 'daily', True))
            self.assertEqual(run.call_args.args[0]['id'], 'enztronic')

    def test_host_checks_opt_out_never_runs_local_host_commands(self):
        profile = entry.project_config(Path(tempfile.gettempdir()) / 'independent-fixture')
        with mock.patch.object(entry.audit, 'run_process') as process, mock.patch.object(entry.audit.shutil, 'disk_usage') as disk:
            rows = entry.audit.server_checks(profile)
        process.assert_not_called()
        disk.assert_not_called()
        self.assertEqual(rows[0]['name'], 'runner-host-scope')
        self.assertIn('Vercel', rows[0]['message'])
        for value in [0, 'false', None]:
            with self.assertRaises(ValueError):
                entry.audit.validate_config({**profile, 'host_checks_required': value})
        with self.assertRaises(ValueError):
            entry.audit.validate_config({**profile, 'docker_containers': ['unexpected']})

    def test_own_private_discord_file_wins_over_different_ambient_webhooks(self):
        own = 'https://discord.com/api/webhooks/123456789/fixture-own-hook'
        ambient = 'https://discord.com/api/webhooks/987654321/fixture-other-hook'
        with tempfile.TemporaryDirectory() as temporary:
            root = config.prepare_runtime(Path(temporary) / 'independent')
            secret = root / 'secrets/discord.env'
            secret.write_text('ENZTRONIC_DISCORD_WEBHOOK_URL=' + own, encoding='utf-8')
            secret.chmod(0o600)
            profile = entry.project_config(root)
            self.assertEqual(entry.audit.load_webhook(profile, {'DISCORD_WEBHOOK_URL': ambient, 'ENZTRONIC_DISCORD_WEBHOOK_URL': ambient}), own)

    def test_existing_lock_symlink_is_rejected_before_open_or_target_chmod(self):
        with tempfile.TemporaryDirectory() as temporary:
            path = Path(temporary) / 'scheduler.lock'
            with mock.patch.object(Path, 'is_symlink', autospec=True, side_effect=lambda candidate: candidate == path), \
                    mock.patch.object(entry.audit.os, 'open') as opened, \
                    mock.patch.object(entry.audit.os, 'chmod') as chmod:
                with self.assertRaises(ValueError):
                    with entry.audit.site_lock(path):
                        self.fail('A symlink lock must never be acquired')
            opened.assert_not_called()
            chmod.assert_not_called()


class InstallerTests(unittest.TestCase):
    def test_cron_is_namespaced_idempotent_and_preserves_all_other_jobs(self):
        original = '# BEGIN OTHER WEBSITE AUDIT\n1 2 * * * /other/site\n# END OTHER WEBSITE AUDIT\n5 1 * * * /usr/local/bin/backup\n'
        root = Path(tempfile.gettempdir()).resolve() / 'enz audit'
        installed, block = install.prepare_crontab(original, root)
        self.assertIn(original.rstrip(), installed)
        self.assertEqual(installed.count('# BEGIN ENZTRONIC WEBSITE AUDIT'), 1)
        self.assertIn('--mode due', block)
        self.assertIn(str(root / 'run.sh'), block)
        self.assertEqual(install.prepare_crontab(installed, root)[0], installed)

    def test_cron_refuses_malformed_markers_and_non_utc_overrides(self):
        root = Path(tempfile.gettempdir()).resolve() / 'enz-audit'
        for malformed in ['# END ENZTRONIC WEBSITE AUDIT\n# BEGIN ENZTRONIC WEBSITE AUDIT\n', '# BEGIN ENZTRONIC WEBSITE AUDIT\n', 'CRON_TZ=Asia/Jakarta\n5 1 * * * existing-job\n']:
            with self.assertRaises(ValueError):
                install.prepare_crontab(malformed, root)

    def test_installer_transfers_only_enz_code_and_three_public_keys(self):
        with tempfile.TemporaryDirectory() as temporary:
            public = Path(temporary) / 'local.env'
            public.write_text('NEXT_PUBLIC_SANITY_PROJECT_ID=fixture\nNEXT_PUBLIC_SANITY_DATASET=production\nSANITY_API_TOKEN=fixture-private\nDISCORD_WEBHOOK_URL=fixture-private\n', encoding='utf-8')
            files = install.installation_files(FOLDER, public)
        self.assertEqual(set(files), set(install.INSTALL_FILES) | {'sites/enztronic-public-env.json'})
        build = json.loads(base64.b64decode(files['sites/enztronic-public-env.json']['content']))
        self.assertEqual(set(build), {'NEXT_PUBLIC_SANITY_PROJECT_ID', 'NEXT_PUBLIC_SANITY_DATASET'})
        self.assertNotIn('fixture-private', json.dumps(files))
        for name in ['run.py', 'runner_config.py', 'repository_check.py', 'audit.py']:
            self.assertIn(name, files)

    def test_remote_script_includes_tested_helpers_and_no_implicit_audit_execution(self):
        compile(install.REMOTE, 'remote-installer', 'exec')
        for name in ['runtime_root', 'prepare_runtime', 'validate_secret_file', 'prepare_crontab']:
            self.assertIn('def ' + name + '(', install.REMOTE)
        self.assertNotIn('# INSTALL_HELPERS', install.REMOTE)
        self.assertIn("if payload['activate_schedule']:", install.REMOTE)
        self.assertNotIn("subprocess.run([str(root/'run.sh')", install.REMOTE)

    def test_install_cli_requires_destination_and_does_not_activate_by_default(self):
        with mock.patch.object(install, 'installation_files', return_value={}), \
                mock.patch.object(install.subprocess, 'run', return_value=SimpleNamespace(returncode=0, stdout=b'{}')) as remote, \
                contextlib.redirect_stdout(io.StringIO()), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit):
                install.main(['--public-env', 'fixture.env'])
            remote.assert_not_called()
            install.main(['--target', 'audit@separate.example', '--public-env', 'fixture.env'])
        payload = json.loads(remote.call_args.kwargs['input'])
        self.assertIs(payload['activate_schedule'], False)
        self.assertIsNone(payload['root'])
        self.assertIn('audit@separate.example', remote.call_args.args[0])


if __name__ == '__main__':
    unittest.main()
