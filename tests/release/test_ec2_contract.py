import importlib.util
import hashlib
import json
import os
import pathlib
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "ec2_contract", ROOT / "deploy" / "ec2" / "release_contract.py"
)
ec2_contract = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ec2_contract)


def valid_manifest():
    return {
        "schemaVersion": 1,
        "component": "lists-service",
        "version": "0.9.0",
        "revision": "a" * 40,
        "image": (
            "154596858576.dkr.ecr.eu-west-1.amazonaws.com/"
            "life2-lists@sha256:" + "b" * 64
        ),
        "migration": "001_loops.sql",
        "migrationSha256": "c" * 64,
    }


class ReleaseContractTest(unittest.TestCase):
    def test_manifest_creation_binds_the_exact_migration_bytes(self):
        with tempfile.TemporaryDirectory() as directory:
            migration = pathlib.Path(directory) / "001_loops.sql"
            migration.write_bytes(b"SELECT 1;\n")
            expected = valid_manifest()
            manifest = ec2_contract.build_manifest(
                revision=expected["revision"], image=expected["image"],
                migration_file=migration,
            )
            self.assertEqual(
                manifest["migrationSha256"], hashlib.sha256(b"SELECT 1;\n").hexdigest()
            )
            ec2_contract.validate_manifest(manifest)

    def test_upgrade_manifest_binds_every_additive_migration(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ec2_contract.UPGRADE_MIGRATIONS:
                (root / name).write_text("SELECT 1;\n")
            manifest = ec2_contract.build_upgrade_manifest(
                revision="a" * 40,
                image=valid_manifest()["image"], migrations_dir=root,
            )
            ec2_contract.validate_manifest(manifest)
            self.assertEqual(manifest["schemaVersion"], 2)
            self.assertEqual(manifest["version"], "0.10.3")
            self.assertEqual(set(manifest["migrations"]), set(ec2_contract.UPGRADE_MIGRATIONS))
            with self.assertRaises(ValueError):
                ec2_contract.validate_manifest(manifest | {"migrations": {"001_loops.sql": "c" * 64}})

    def test_manifest_requires_exact_immutable_identity(self):
        ec2_contract.validate_manifest(valid_manifest())
        for mutation in (
            {"image": "example.invalid/life2-lists:latest"},
            {"revision": "not-a-revision"},
            {"migrationSha256": "bad"},
            {"secret": "unexpected"},
            {"version": "0.8.0"},
        ):
            with self.subTest(mutation=mutation):
                with self.assertRaises(ValueError):
                    ec2_contract.validate_manifest(valid_manifest() | mutation)

    def test_manifest_parser_rejects_duplicate_json_keys(self):
        raw = json.dumps(valid_manifest()).removesuffix("}") + ',"version":"0.8.0"}'
        with self.assertRaises(ValueError):
            ec2_contract.parse_manifest(raw.encode())

    def test_protected_candidate_environment_is_exact_and_non_executable(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "candidate.env"
            path.write_text(
                "SECRET_PROVIDER=aws\n"
                "AWS_REGION=eu-west-1\n"
                "HOST=0.0.0.0\n"
                "PORT=3000\n"
                "DATABASE_URL=postgresql://runtime:encoded@postgres:5432/lists_service\n"
                "REST_API_TOKEN_SECRET_ARN=arn:aws:secretsmanager:eu-west-1:154596858576:secret:rest\n"
                "LIFE2_JWT_SIGNING_KEY_SECRET_ARN=arn:aws:secretsmanager:eu-west-1:154596858576:secret:jwt\n"
                "TODOIST_TENANT_CATALOG_SECRET_ARN=arn:aws:secretsmanager:eu-west-1:154596858576:secret:catalog\n"
                "LIFE2_ALLOWED_ACCOUNT_ID=account-123\n"
            )
            path.chmod(0o600)
            values = ec2_contract.load_protected_env(path, "runtime", expected_uid=os.getuid())
            self.assertEqual(values["SECRET_PROVIDER"], "aws")
            for bad_line in (
                "EXTRA=bad\n", "PORT=$(id)\n", "SECRET_PROVIDER=file\n",
                "LOG_LEVEL=$HOME\n", "LOG_LEVEL=info # comment\n",
                'LOG_LEVEL="info"\n',
            ):
                with self.subTest(bad_line=bad_line):
                    with path.open("a") as output:
                        output.write(bad_line)
                    with self.assertRaises(ValueError):
                        ec2_contract.load_protected_env(path, "runtime", expected_uid=os.getuid())
                    path.write_text(path.read_text().removesuffix(bad_line))

    def test_migration_and_backup_credentials_are_separate_from_runtime(self):
        with tempfile.TemporaryDirectory() as directory:
            migration = pathlib.Path(directory) / "migration.env"
            migration.write_text(
                "DATABASE_URL=postgresql://migrator:encoded@postgres:5432/lists_service\n"
            )
            migration.chmod(0o600)
            backup = pathlib.Path(directory) / "backup.env"
            backup.write_text(
                "PGHOST_HELPER=127.0.0.1\n"
                "PGDATABASE=lists_service\n"
                "PGUSER_BACKUP=backup\n"
                "PGPASSWORD_BACKUP=protected\n"
                "PGUSER_RESTORE=restore\n"
                "PGPASSWORD_RESTORE=protected\n"
            )
            backup.chmod(0o600)
            self.assertIn(
                "DATABASE_URL",
                ec2_contract.load_protected_env(migration, "migration", expected_uid=os.getuid()),
            )
            self.assertIn(
                "PGHOST_HELPER",
                ec2_contract.load_protected_env(backup, "backup", expected_uid=os.getuid()),
            )
            with migration.open("a") as output:
                output.write("REST_API_TOKEN_SECRET_ARN=wrong\n")
            with self.assertRaises(ValueError):
                ec2_contract.load_protected_env(migration, "migration", expected_uid=os.getuid())

    def test_protected_environment_rejects_symlink_and_open_permissions(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "candidate.env"
            path.write_text("SECRET_PROVIDER=aws\n")
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                ec2_contract.load_protected_env(path, "runtime", expected_uid=os.getuid())
            path.chmod(0o600)
            link = pathlib.Path(directory) / "link.env"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                ec2_contract.load_protected_env(link, "runtime", expected_uid=os.getuid())


if __name__ == "__main__":
    unittest.main()
