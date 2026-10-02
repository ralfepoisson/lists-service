#!/usr/bin/env python3
"""Create and restore-test a Lists PostgreSQL archive before a migration."""

import argparse
import hashlib
import os
import pathlib
import secrets
import stat
import subprocess

from release_contract import load_protected_env


class BackupRestoreError(Exception):
    pass


def _run(binary, arguments, *, user, password, host, port, stdout=subprocess.PIPE):
    environment = {
        **os.environ,
        "PGPASSWORD": password,
        "PGCONNECT_TIMEOUT": "10",
    }
    command = [str(binary), "-h", host, "-p", str(port), "-U", user, *arguments]
    try:
        return subprocess.run(
            command, env=environment, stdout=stdout, stderr=subprocess.PIPE,
            check=True, timeout=120,
        )
    except (OSError, subprocess.SubprocessError) as exc:
        raise BackupRestoreError("PostgreSQL backup or restore gate failed") from exc


def _counts(bin_dir, *, host, port, database, user, password):
    table_presence = _run(
        bin_dir / "psql", [
            "-X", "-A", "-t", "-d", database, "-c",
            "SELECT (to_regclass('public.loops') IS NOT NULL)::int || ',' || "
            "(to_regclass('public.loop_related_records') IS NOT NULL)::int",
        ],
        user=user, password=password, host=host, port=port,
    ).stdout.decode("ascii").strip()
    if table_presence == "0,0":
        return (None, None)
    if table_presence != "1,1":
        raise BackupRestoreError("Lists schema is partially present")
    query = (
        "SELECT (SELECT count(*) FROM loops)::text || ',' || "
        "(SELECT count(*) FROM loop_related_records)::text"
    )
    result = _run(
        bin_dir / "psql", ["-X", "-A", "-t", "-d", database, "-c", query],
        user=user, password=password, host=host, port=port,
    )
    try:
        values = tuple(int(value) for value in result.stdout.decode("ascii").strip().split(","))
    except (UnicodeDecodeError, ValueError) as exc:
        raise BackupRestoreError("PostgreSQL row-count verification failed") from exc
    if len(values) != 2 or any(value < 0 for value in values):
        raise BackupRestoreError("PostgreSQL row-count verification failed")
    return values


def _public_table_count(bin_dir, *, host, port, database, user, password):
    result = _run(
        bin_dir / "psql", [
            "-X", "-A", "-t", "-d", database, "-c",
            "SELECT count(*) FROM pg_catalog.pg_tables WHERE schemaname = 'public'",
        ],
        user=user, password=password, host=host, port=port,
    )
    try:
        return int(result.stdout.decode("ascii").strip())
    except (UnicodeDecodeError, ValueError) as exc:
        raise BackupRestoreError("PostgreSQL schema count verification failed") from exc


def perform_backup_restore(
    *, host, port, database, backup_user, backup_password, restore_user,
    restore_password, backup_path, bin_dir,
):
    """Run a real dump, archive check, restore to a unique database, and row comparison."""
    if host != "127.0.0.1" or not 1 <= int(port) <= 65535:
        raise BackupRestoreError("backup must use PostgreSQL loopback")
    if not database or not backup_user or not restore_user:
        raise BackupRestoreError("backup identities are incomplete")
    backup_path = pathlib.Path(backup_path)
    bin_dir = pathlib.Path(bin_dir)
    for name in ("pg_dump", "pg_restore", "createdb", "dropdb", "psql"):
        if not (bin_dir / name).is_file() or not os.access(bin_dir / name, os.X_OK):
            raise BackupRestoreError("required PostgreSQL client is unavailable")
    directory = backup_path.parent.lstat()
    if not stat.S_ISDIR(directory.st_mode) or stat.S_IMODE(directory.st_mode) & 0o007:
        raise BackupRestoreError("backup directory is not private")
    fd = os.open(backup_path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    try:
        _run(
            bin_dir / "pg_dump", ["-Fc", "-d", database], user=backup_user,
            password=backup_password, host=host, port=port, stdout=fd,
        )
        os.fsync(fd)
    finally:
        os.close(fd)
    with backup_path.open("rb") as archive:
        if archive.read(5) != b"PGDMP":
            raise BackupRestoreError("PostgreSQL archive header is invalid")
    _run(
        bin_dir / "pg_restore", ["--list", str(backup_path)], user=backup_user,
        password=backup_password, host=host, port=port,
    )
    scratch = "lists_restore_" + secrets.token_hex(8)
    created = False
    try:
        _run(
            bin_dir / "createdb", [scratch], user=restore_user,
            password=restore_password, host=host, port=port,
        )
        created = True
        _run(
            bin_dir / "pg_restore",
            ["--exit-on-error", "--no-owner", "--no-acl", "-d", scratch, str(backup_path)],
            user=restore_user, password=restore_password, host=host, port=port,
        )
        source_counts = _counts(
            bin_dir, host=host, port=port, database=database,
            user=backup_user, password=backup_password,
        )
        restored_counts = _counts(
            bin_dir, host=host, port=port, database=scratch,
            user=restore_user, password=restore_password,
        )
        if source_counts != restored_counts:
            raise BackupRestoreError("restored Lists row counts differ from the source")
        source_tables = _public_table_count(
            bin_dir, host=host, port=port, database=database,
            user=backup_user, password=backup_password,
        )
        restored_tables = _public_table_count(
            bin_dir, host=host, port=port, database=scratch,
            user=restore_user, password=restore_password,
        )
        if source_tables != restored_tables:
            raise BackupRestoreError("restored Lists schema differs from the source")
    finally:
        if created:
            _run(
                bin_dir / "dropdb", ["--if-exists", scratch], user=restore_user,
                password=restore_password, host=host, port=port,
            )
    checksum = hashlib.sha256(backup_path.read_bytes()).hexdigest()
    return {
        "source_counts": source_counts,
        "restored_counts": restored_counts,
        "schema_table_count": source_tables,
        "sha256": checksum,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("environment", type=pathlib.Path)
    parser.add_argument("backup", type=pathlib.Path)
    args = parser.parse_args()
    if os.geteuid() != 0:
        parser.exit(1, "backup_restore=requires_root\n")
    try:
        values = load_protected_env(args.environment, "backup")
        result = perform_backup_restore(
            host=values["PGHOST_HELPER"], port=5432, database=values["PGDATABASE"],
            backup_user=values["PGUSER_BACKUP"],
            backup_password=values["PGPASSWORD_BACKUP"],
            restore_user=values["PGUSER_RESTORE"],
            restore_password=values["PGPASSWORD_RESTORE"],
            backup_path=args.backup, bin_dir=pathlib.Path("/usr/bin"),
        )
        print("backup_restore=verified sha256=" + result["sha256"])
    except (OSError, ValueError, BackupRestoreError):
        parser.exit(1, "backup_restore=failed\n")


if __name__ == "__main__":
    main()
