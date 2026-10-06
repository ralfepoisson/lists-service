"""Unit isolation for the restored-database rehearsal callback and cleanup."""
import pathlib
import sys
import tempfile
import unittest
from unittest.mock import patch

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2] / 'deploy/ec2'))
import backup_restore


class RehearsalTest(unittest.TestCase):
    def test_failed_rehearsal_blocks_completion_and_drops_only_the_scratch_database(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ('pg_dump', 'pg_restore', 'createdb', 'dropdb', 'psql'):
                path = root / name
                path.touch()
                path.chmod(0o700)
            calls = []
            def run(binary, arguments, **kwargs):
                calls.append((binary.name, arguments))
                if binary.name == 'pg_dump':
                    import os
                    os.write(kwargs['stdout'], b'PGDMPtest')
            def rehearse(database):
                self.assertTrue(database.startswith('lists_restore_'))
                raise RuntimeError('rehearsal rejected')
            with patch.object(backup_restore, '_run', side_effect=run), patch.object(
                backup_restore, '_counts', return_value=(2, 3)
            ), patch.object(backup_restore, '_public_table_count', return_value=3):
                with self.assertRaisesRegex(RuntimeError, 'rehearsal rejected'):
                    backup_restore.perform_backup_restore(
                        host='127.0.0.1', port=5432, database='lists_service',
                        backup_user='backup', backup_password='unit', restore_user='restore',
                        restore_password='unit', backup_path=root / 'backup.dump', bin_dir=root,
                        rehearsal=rehearse,
                    )
            self.assertEqual(calls[-1][0], 'dropdb')
            self.assertTrue(calls[-1][1][-1].startswith('lists_restore_'))
            self.assertNotEqual(calls[-1][1][-1], 'lists_service')
