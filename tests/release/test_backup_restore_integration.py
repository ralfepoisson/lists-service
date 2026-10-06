import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from urllib.parse import urlsplit


ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "ec2"))
SPEC = importlib.util.spec_from_file_location(
    "backup_restore", ROOT / "deploy" / "ec2" / "backup_restore.py"
)
backup_restore = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(backup_restore)


@unittest.skipUnless(os.environ.get("LISTS_TEST_DATABASE_URL"), "disposable PostgreSQL required")
class RealPostgresBackupRestoreTest(unittest.TestCase):
    def test_dump_restores_in_an_isolated_database_and_compares_loop_counts(self):
        parsed = urlsplit(os.environ["LISTS_TEST_DATABASE_URL"])
        with tempfile.TemporaryDirectory() as directory:
            backup = pathlib.Path(directory) / "lists.dump"
            result = backup_restore.perform_backup_restore(
                host="127.0.0.1",
                port=parsed.port,
                database=parsed.path.lstrip("/"),
                backup_user=parsed.username,
                backup_password="",
                restore_user=parsed.username,
                restore_password="",
                backup_path=backup,
                bin_dir=pathlib.Path(os.environ["POSTGRES_BIN_DIR"]),
            )
            self.assertEqual(result["source_counts"], result["restored_counts"])
            self.assertEqual(len(result["source_counts"]), 2)
            # Migrations 001–004 include tags, assignments, and profile comments.
            self.assertEqual(result["schema_table_count"], 6)
            self.assertTrue(backup.read_bytes().startswith(b"PGDMP"))
            self.assertEqual(backup.stat().st_mode & 0o777, 0o600)

    def test_empty_pre_migration_database_can_be_backed_up_and_restored(self):
        parsed = urlsplit(os.environ["LISTS_TEST_DATABASE_URL"])
        bin_dir = pathlib.Path(os.environ["POSTGRES_BIN_DIR"])
        common = ["-h", "127.0.0.1", "-p", str(parsed.port), "-U", parsed.username]
        subprocess.run([str(bin_dir / "createdb"), *common, "lists_empty_test"], check=True)
        try:
            with tempfile.TemporaryDirectory() as directory:
                result = backup_restore.perform_backup_restore(
                    host="127.0.0.1", port=parsed.port, database="lists_empty_test",
                    backup_user=parsed.username, backup_password="",
                    restore_user=parsed.username, restore_password="",
                    backup_path=pathlib.Path(directory) / "empty.dump", bin_dir=bin_dir,
                )
                self.assertEqual(result["source_counts"], (None, None))
                self.assertEqual(result["source_counts"], result["restored_counts"])
                self.assertEqual(result["schema_table_count"], 0)
        finally:
            subprocess.run([str(bin_dir / "dropdb"), *common, "lists_empty_test"], check=True)


if __name__ == "__main__":
    unittest.main()
