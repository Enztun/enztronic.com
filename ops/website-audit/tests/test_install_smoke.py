"""Installer preparation and GET-only smoke fixtures; no SSH or live website calls."""
from email.message import Message
import ast
import importlib.util
import json
import os
from pathlib import Path
import stat
import tempfile
from types import SimpleNamespace
import unittest
from unittest import mock


def load_module(name, filename):
    path = Path(__file__).resolve().parents[1] / filename
    spec = importlib.util.spec_from_file_location(name, path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


install = load_module('audit_installer', 'install.py')
smoke = load_module('production_smoke', 'production_smoke.py')


def page(total, offset=0, identity='fixture-job'):
    more = total > offset + 1
    return {'ok': True, 'total': total, 'jobs': [{'id': identity}] if total > offset else [],
            'hasMore': more, 'nextOffset': offset + 1 if more else None}


def response(document):
    return 200, Message(), json.dumps(document).encode()


class InstallerTests(unittest.TestCase):
    def test_cron_reinstall_preserves_other_jobs_and_is_idempotent(self):
        original = 'MAILTO=operator@example.test\n5 1 * * * /usr/local/bin/backup\n30 2 * * * /usr/local/bin/deploy-check\n'
        installed, block = install.prepare_crontab(original)
        self.assertIn(original.rstrip(), installed)
        self.assertEqual(installed.count('# BEGIN WEBSITE AUDIT'), 1)
        self.assertIn('30 19 * * * /home/deploy/website-audit/run.sh', block)
        self.assertEqual(install.prepare_crontab(installed)[0], installed)

    def test_cron_refuses_malformed_markers_and_non_utc_override(self):
        for malformed in ['# END WEBSITE AUDIT\n# BEGIN WEBSITE AUDIT\n', '# BEGIN WEBSITE AUDIT\n', '# END WEBSITE AUDIT\n', '# BEGIN WEBSITE AUDIT\n# BEGIN WEBSITE AUDIT\n# END WEBSITE AUDIT\n# END WEBSITE AUDIT\n', 'CRON_TZ=Asia/Jakarta\n5 1 * * * existing-job\n']:
            with self.assertRaises(RuntimeError):
                install.prepare_crontab(malformed)
        self.assertIn('CRON_TZ="UTC"', install.prepare_crontab('CRON_TZ="UTC"\n')[0])

    def test_remote_script_contains_the_tested_preparation_helpers(self):
        compile(install.REMOTE, 'remote-installer', 'exec')
        for name in ['ensure_private_directory', 'validate_secret_file', 'prepare_crontab']:
            self.assertIn('def ' + name + '(', install.REMOTE)
        self.assertNotIn('# INSTALL_HELPERS', install.REMOTE)

    def test_installation_rejects_symlinked_parent_directory(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            target, link = root / 'outside', root / 'sites'
            target.mkdir()
            try:
                link.symlink_to(target, target_is_directory=True)
            except (OSError, NotImplementedError):
                self.skipTest('OS account cannot create directory symlinks')
            with self.assertRaises(RuntimeError):
                install.ensure_private_directory(link)

    def test_directory_symlink_guard_precedes_any_mutation(self):
        path = mock.Mock()
        path.is_symlink.return_value = True
        with self.assertRaises(RuntimeError):
            install.ensure_private_directory(path)
        path.mkdir.assert_not_called()
        path.chmod.assert_not_called()

    def test_secret_is_metadata_validated_without_reading_contents(self):
        path = mock.Mock()
        path.is_symlink.return_value = False
        path.stat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=17)
        with mock.patch.object(os, 'getuid', return_value=17, create=True):
            install.validate_secret_file(path)
            path.read_text.assert_not_called()
            path.stat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o644, st_uid=17)
            with self.assertRaises(RuntimeError):
                install.validate_secret_file(path)
            path.stat.return_value = SimpleNamespace(st_mode=stat.S_IFREG | 0o600, st_uid=18)
            with self.assertRaises(RuntimeError):
                install.validate_secret_file(path)
            path.is_symlink.return_value = True
            with self.assertRaises(RuntimeError):
                install.validate_secret_file(path)


class SmokeTests(unittest.TestCase):
    def test_validation_is_retained_under_python_optimization(self):
        path = Path(smoke.__file__)
        source = path.read_text(encoding='utf-8')
        self.assertFalse(any(isinstance(node, ast.Assert) for node in ast.walk(ast.parse(source))))
        namespace = {'__name__': 'optimized_fixture'}
        exec(compile(source, str(path), 'exec', optimize=2), namespace)
        with self.assertRaises(RuntimeError):
            namespace['require'](False, 'Fixture contract must fail')

    def test_empty_and_single_job_catalogs_are_valid(self):
        for total in (0, 1):
            with mock.patch.object(smoke, 'get', return_value=response(page(total))) as request:
                self.assertTrue(smoke.verify_pagination('https://fixture.example'))
            self.assertEqual(request.call_count, 1)

    def test_pagination_retries_a_changed_catalog_then_verifies_a_stable_pair(self):
        responses = [response(page(2, identity='a')), response(page(3, 1, 'a')),
                     response(page(3, identity='b')), response(page(3, 1, 'a'))]
        with mock.patch.object(smoke, 'get', side_effect=responses) as request:
            self.assertTrue(smoke.verify_pagination('https://fixture.example'))
        self.assertEqual(request.call_count, 4)

    def test_malformed_empty_offset_and_duplicate_catalog_do_not_pass_or_loop(self):
        malformed = page(0)
        malformed['nextOffset'] = 1
        with mock.patch.object(smoke, 'get', return_value=response(malformed)) as request:
            with self.assertRaises(RuntimeError):
                smoke.verify_pagination('https://fixture.example')
        self.assertEqual(request.call_count, 3)
        with mock.patch.object(smoke, 'get', side_effect=[response(page(2)), response(page(2, 1))] * 3) as request:
            with self.assertRaises(RuntimeError):
                smoke.verify_pagination('https://fixture.example')
        self.assertEqual(request.call_count, 6)

    def test_boolean_total_is_not_accepted_as_an_integer_count(self):
        with self.assertRaises(RuntimeError):
            smoke.verify_page(page(True), 0)

    def test_get_is_explicitly_credential_free_get_and_bounded(self):
        opened = mock.MagicMock()
        opened.status, opened.headers = 200, Message()
        opened.__enter__.return_value = opened
        opened.read1.side_effect = [b'fixture', b'']
        opener = mock.Mock()
        opener.open.return_value = opened
        with mock.patch.object(smoke.urllib.request, 'build_opener', return_value=opener):
            self.assertEqual(smoke.get('https://fixture.example')[2], b'fixture')
        request = opener.open.call_args.args[0]
        self.assertEqual(request.get_method(), 'GET')
        self.assertIsNone(request.data)
        self.assertNotIn('Cookie', dict(request.header_items()))
        self.assertNotIn('Authorization', dict(request.header_items()))
        self.assertLessEqual(opener.open.call_args.kwargs['timeout'], 10)

    def test_body_deadline_cannot_be_extended_by_small_chunks(self):
        opened = mock.MagicMock()
        opened.__enter__.return_value = opened
        opened.read1.return_value = b'x'
        opener = mock.Mock()
        opener.open.return_value = opened
        with mock.patch.object(smoke.urllib.request, 'build_opener', return_value=opener), mock.patch.object(smoke.time, 'monotonic', side_effect=[0, 0, 11]):
            with self.assertRaises(RuntimeError):
                smoke.get('https://fixture.example')
        self.assertEqual(opened.read1.call_count, 1)


if __name__ == '__main__':
    unittest.main()
