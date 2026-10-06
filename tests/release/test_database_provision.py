import importlib.util
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit


ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "ec2"))
SPEC = importlib.util.spec_from_file_location(
    "database_provision", ROOT / "deploy" / "ec2" / "database_provision.py"
)
database_provision = importlib.util.module_from_spec(SPEC)
if SPEC.loader is not None:
    SPEC.loader.exec_module(database_provision)
from backup_restore import perform_backup_restore


def inputs():
    return {
        "REST_API_TOKEN_SECRET_ARN": "arn:aws:secretsmanager:eu-west-1:154596858576:secret:rest",
        "LIFE2_JWT_SIGNING_KEY_SECRET_ARN": "arn:aws:secretsmanager:eu-west-1:154596858576:secret:jwt",
        "TODOIST_TENANT_CATALOG_SECRET_ARN": "arn:aws:secretsmanager:eu-west-1:154596858576:secret:catalog",
        "LIFE2_ALLOWED_ACCOUNT_ID": "primary-account",
        "PGPASSWORD_RUNTIME": "r" * 48,
        "PGPASSWORD_MIGRATOR": "m" * 48,
        "PGPASSWORD_BACKUP": "b" * 48,
        "PGPASSWORD_RESTORE": "s" * 48,
    }


class DatabaseProvisionTest(unittest.TestCase):
    def test_sql_creates_distinct_roles_with_only_restore_createdb(self):
        phases = database_provision.sql_phases(inputs())
        self.assertEqual(len(phases), 3)
        all_sql = "\n".join(phases)
        self.assertIn("CREATE ROLE lists_restore LOGIN CREATEDB", all_sql)
        for role in ("lists_runtime", "lists_migrator", "lists_backup"):
            self.assertIn(f"CREATE ROLE {role} LOGIN NOCREATEDB", all_sql)
        self.assertIn("CREATE DATABASE lists_service OWNER lists_migrator", all_sql)
        self.assertIn("REVOKE ALL ON DATABASE lists_service FROM PUBLIC", all_sql)
        self.assertIn("GRANT CONNECT ON DATABASE lists_service TO lists_runtime", all_sql)
        self.assertNotIn("GRANT CONNECT ON DATABASE lists_service TO lists_restore", all_sql)
        self.assertIn("ALTER DEFAULT PRIVILEGES FOR ROLE lists_migrator", all_sql)
        self.assertIn("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lists_runtime", all_sql)
        self.assertIn("GRANT SELECT ON TABLES TO lists_backup", all_sql)
        self.assertIn("GRANT SELECT ON SEQUENCES TO lists_backup", all_sql)
        self.assertNotIn("GRANT ALL ON TABLES TO lists_runtime", all_sql)

    def test_environment_outputs_are_separated_and_round_trip_contract(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = pathlib.Path(directory)
            values = inputs()
            rendered = database_provision.render_environments(values)
            self.assertEqual(set(rendered), {"runtime.env", "migration.env", "backup.env"})
            self.assertNotIn("PGPASSWORD_MIGRATOR", rendered["runtime.env"])
            self.assertNotIn("PGPASSWORD_RESTORE", rendered["runtime.env"])
            self.assertNotIn("REST_API_TOKEN_SECRET_ARN", rendered["migration.env"])
            for name, content in rendered.items():
                path = parent / name
                path.write_text(content)
                path.chmod(0o600)
                parsed = database_provision.load_protected_env(
                    path, name.removesuffix(".env"), expected_uid=os.getuid()
                )
                self.assertTrue(parsed)
                self.assertNotIn("lists_restore", rendered["runtime.env"])

    def test_provision_input_rejects_duplicate_or_short_passwords_and_open_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "provision.env"
            content = "".join(f"{key}={value}\n" for key, value in inputs().items())
            path.write_text(content)
            path.chmod(0o600)
            self.assertEqual(database_provision.load_input(path, expected_uid=os.getuid()), inputs())
            for invalid in ("PGPASSWORD_BACKUP=short\n", "PGPASSWORD_RUNTIME=" + "m" * 48 + "\n"):
                with self.subTest(invalid=invalid):
                    path.write_text(content + invalid)
                    with self.assertRaises(ValueError):
                        database_provision.load_input(path, expected_uid=os.getuid())
            path.write_text(content)
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                database_provision.load_input(path, expected_uid=os.getuid())

    def test_existing_database_or_role_is_a_hard_stop(self):
        for database_exists, role_exists in ((True, False), (False, True)):
            with self.subTest(database_exists=database_exists, role_exists=role_exists):
                with self.assertRaises(ValueError):
                    database_provision.require_unused_target(database_exists, role_exists)

    def test_uninstalled_source_cannot_apply_to_host(self):
        with patch.object(database_provision.os, "geteuid", return_value=0):
            with self.assertRaises(ValueError):
                database_provision._check_installed()


@unittest.skipUnless(os.environ.get("LISTS_TEST_DATABASE_URL"), "disposable PostgreSQL required")
class RealDatabaseRoleTest(unittest.TestCase):
    def test_runtime_backup_and_restore_privileges_on_migrator_table(self):
        parsed = urlsplit(os.environ["LISTS_TEST_DATABASE_URL"])
        binary = str(pathlib.Path(os.environ["POSTGRES_BIN_DIR"]) / "psql")

        def sql(database, role, statement, *, succeeds=True):
            result = subprocess.run(
                [binary, "-X", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-h", "127.0.0.1",
                 "-p", str(parsed.port), "-U", role, "-d", database],
                input=statement, text=True, capture_output=True, check=False,
            )
            self.assertEqual(result.returncode == 0, succeeds, result.stderr)
            return result.stdout.strip()

        values = inputs()
        for index, phase in enumerate(database_provision.sql_phases(values)):
            sql("lists_service" if index == 2 else "postgres", parsed.username, phase)
        sql("lists_service", "lists_migrator", "CREATE TABLE privilege_probe (id integer GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY);")
        sql("lists_service", "lists_runtime", "INSERT INTO privilege_probe VALUES (1);")
        self.assertEqual(sql("lists_service", "lists_backup", "SELECT count(*) FROM privilege_probe;"), "1")
        self.assertEqual(sql("lists_service", "lists_backup", "SELECT last_value FROM privilege_probe_id_seq;"), "1")
        sql("lists_service", "lists_backup", "SELECT nextval('privilege_probe_id_seq');", succeeds=False)
        sql("lists_service", "lists_backup", "INSERT INTO privilege_probe VALUES (2);", succeeds=False)
        sql("lists_service", "lists_runtime", "ALTER TABLE privilege_probe ADD COLUMN forbidden integer;", succeeds=False)
        sql("lists_service", "lists_restore", "SELECT 1;", succeeds=False)
        sql("postgres", "lists_restore", "CREATE DATABASE lists_restore_privilege_probe;")
        sql("postgres", "lists_restore", "DROP DATABASE lists_restore_privilege_probe;")
        with tempfile.TemporaryDirectory() as directory:
            backup = pathlib.Path(directory) / "role-boundary.dump"
            result = perform_backup_restore(
                host="127.0.0.1", port=parsed.port, database="lists_service",
                backup_user="lists_backup", backup_password=values["PGPASSWORD_BACKUP"],
                restore_user="lists_restore", restore_password=values["PGPASSWORD_RESTORE"],
                backup_path=backup, bin_dir=pathlib.Path(os.environ["POSTGRES_BIN_DIR"]),
            )
            self.assertEqual(result["source_counts"], result["restored_counts"])
            self.assertEqual(result["schema_table_count"], 1)


if __name__ == "__main__":
    unittest.main()
