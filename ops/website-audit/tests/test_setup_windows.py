"""Bootstrap fixtures only; no real webhook, download, task or production calls."""
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import unittest
from unittest import mock

FOLDER = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(FOLDER))
spec = importlib.util.spec_from_file_location('windows_bootstrap', FOLDER / 'setup_windows.py')
setup = importlib.util.module_from_spec(spec)
spec.loader.exec_module(setup)


class BootstrapTests(unittest.TestCase):
    def test_public_settings_never_copy_provider_or_webhook_credentials(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'input.env'
            path.write_text('NEXT_PUBLIC_SANITY_PROJECT_ID=fixture\nNEXT_PUBLIC_SANITY_DATASET=production\nSANITY_API_TOKEN=fixture-private\nDISCORD_WEBHOOK_URL=fixture-private\n')
            result = setup.read_public_settings(path)
        self.assertEqual(result, {'NEXT_PUBLIC_SANITY_PROJECT_ID': 'fixture', 'NEXT_PUBLIC_SANITY_DATASET': 'production'})
        self.assertNotIn('fixture-private', json.dumps(result))

    def test_webhook_assignment_is_data_and_conflicting_values_are_rejected(self):
        hook = 'https://discord.com/api/webhooks/123456789/fixture-own-hook'
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'input.env'
            path.write_text('DISCORD_WEBHOOK_URL="' + hook + '"\nIGNORED=$(no-command)\n')
            self.assertEqual(setup.read_webhook_assignment(path), hook)
            path.write_text('DISCORD_WEBHOOK_URL=' + hook + '\nENZTRONIC_DISCORD_WEBHOOK_URL=' + hook + '-other\n')
            with self.assertRaises(ValueError):
                setup.read_webhook_assignment(path)

    def test_scanner_checksum_mismatch_is_rejected_before_zip_processing(self):
        with mock.patch.object(setup.zipfile, 'ZipFile') as archive:
            with self.assertRaises(ValueError):
                setup.scanner_binary(b'fixture-unverified-program')
        archive.assert_not_called()

    def test_existing_foreign_directory_is_rejected_before_secret_read_or_mutation(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder) / 'other-app'
            root.mkdir()
            (root / 'existing.txt').write_text('fixture')
            with mock.patch.object(setup, 'prepare_runtime') as create, mock.patch.object(setup, 'read_webhook_assignment') as secret:
                with self.assertRaises(ValueError):
                    setup.setup(root, Path('unused.env'), Path('unused-secret.env'))
            create.assert_not_called()
            secret.assert_not_called()

    def test_snapshot_never_contains_environment_or_application_files(self):
        self.assertIn('native_repository.py', setup.FILES)
        self.assertIn('scheduled_run.py', setup.FILES)
        self.assertFalse(any(name.endswith('.env') or name.startswith(('src/', 'apps/')) for name in setup.FILES))


if __name__ == '__main__':
    unittest.main()
