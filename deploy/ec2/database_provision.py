#!/usr/bin/env python3
"""One-time, fail-closed Lists database and protected-environment provisioner.

This installed root tool never selects ingress or changes the retained Lambda.
It refuses an existing Lists database or role; partial application requires
operator reconciliation rather than an automatic drop or password rotation.
"""

import argparse
import os
import pathlib
import re
import stat
import subprocess
from urllib.parse import quote

from release_contract import ACCOUNT, REGION, load_protected_env


APP_ROOT = pathlib.Path("/srv/apps/life2-lists")
INSTALLED = pathlib.Path("/usr/local/libexec/life2-lists/database_provision.py")
SHARED = APP_ROOT / "shared"
INPUT_KEYS = {
    "REST_API_TOKEN_SECRET_ARN", "LIFE2_JWT_SIGNING_KEY_SECRET_ARN",
    "TODOIST_TENANT_CATALOG_SECRET_ARN", "LIFE2_ALLOWED_ACCOUNT_ID",
    "PGPASSWORD_RUNTIME", "PGPASSWORD_MIGRATOR", "PGPASSWORD_BACKUP",
    "PGPASSWORD_RESTORE",
}
PASSWORD_KEYS = tuple(sorted(key for key in INPUT_KEYS if key.startswith("PGPASSWORD_")))
ROLES = ("lists_runtime", "lists_migrator", "lists_backup", "lists_restore")
BACKUP_SEQUENCE_GRANTS = (
    "GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO lists_backup;\n"
    "ALTER DEFAULT PRIVILEGES FOR ROLE lists_migrator IN SCHEMA public "
    "GRANT SELECT ON SEQUENCES TO lists_backup;\n"
)
DOCKER = "/usr/bin/docker"


def load_input(path, expected_uid=0):
    """Read a root-only, literal file without sourcing or displaying its values."""
    path = pathlib.Path(path)
    parent = path.parent.lstat()
    metadata = path.lstat()
    if (
        not stat.S_ISDIR(parent.st_mode) or parent.st_uid != expected_uid
        or stat.S_IMODE(parent.st_mode) != 0o700
        or not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != expected_uid
        or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600
        or (expected_uid == 0 and (parent.st_gid != 0 or metadata.st_gid != 0))
    ):
        raise ValueError("provision input metadata is unsafe")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if (opened.st_dev, opened.st_ino) != (metadata.st_dev, metadata.st_ino):
            raise ValueError("provision input changed while reading")
        with os.fdopen(fd, "r", encoding="utf-8") as source:
            content = source.read(8193)
    except UnicodeDecodeError as exc:
        raise ValueError("provision input must be UTF-8") from exc
    if not 1 <= len(content) <= 8192 or "\x00" in content:
        raise ValueError("provision input size is invalid")
    values = {}
    for line in content.splitlines():
        if not line or "=" not in line:
            raise ValueError("provision input has invalid lines")
        key, value = line.split("=", 1)
        if key not in INPUT_KEYS or key in values or not value:
            raise ValueError("provision input has missing or unexpected fields")
        values[key] = value
    if set(values) != INPUT_KEYS:
        raise ValueError("provision input is incomplete")
    passwords = [values[key] for key in PASSWORD_KEYS]
    if len(set(passwords)) != len(passwords) or any(
        not re.fullmatch(r"[A-Za-z0-9_-]{40,128}", password) for password in passwords
    ):
        raise ValueError("four distinct URL-safe database passwords of at least 40 characters are required")
    arn_pattern = rf"arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:[A-Za-z0-9/_+=.@-]+"
    for key in ("REST_API_TOKEN_SECRET_ARN", "LIFE2_JWT_SIGNING_KEY_SECRET_ARN", "TODOIST_TENANT_CATALOG_SECRET_ARN"):
        if not re.fullmatch(arn_pattern, values[key]):
            raise ValueError("provision input contains an out-of-account secret reference")
    if not re.fullmatch(r"[A-Za-z0-9_-]{1,255}", values["LIFE2_ALLOWED_ACCOUNT_ID"]):
        raise ValueError("provision account identifier is invalid")
    return values


def sql_phases(values):
    """Fixed identifiers; only validated URL-safe passwords enter SQL literals."""
    passwords = [values[key] for key in PASSWORD_KEYS]
    if len(set(passwords)) != 4 or any(
        not re.fullmatch(r"[A-Za-z0-9_-]{40,128}", password) for password in passwords
    ):
        raise ValueError("invalid database password set")
    role_passwords = {
        "lists_runtime": values["PGPASSWORD_RUNTIME"],
        "lists_migrator": values["PGPASSWORD_MIGRATOR"],
        "lists_backup": values["PGPASSWORD_BACKUP"],
        "lists_restore": values["PGPASSWORD_RESTORE"],
    }
    roles = "\n".join(
        f"CREATE ROLE {role} LOGIN {'CREATEDB' if role == 'lists_restore' else 'NOCREATEDB'} "
        f"NOSUPERUSER NOCREATEROLE NOINHERIT NOREPLICATION PASSWORD '{password}';"
        for role, password in role_passwords.items()
    )
    return (
        "BEGIN;\n" + roles + "\nCOMMIT;\n",
        "CREATE DATABASE lists_service OWNER lists_migrator ENCODING 'UTF8' TEMPLATE template0;\n",
        "REVOKE ALL ON DATABASE lists_service FROM PUBLIC;\n"
        "GRANT CONNECT ON DATABASE lists_service TO lists_runtime, lists_migrator, lists_backup;\n"
        "REVOKE ALL ON SCHEMA public FROM PUBLIC;\n"
        "GRANT USAGE ON SCHEMA public TO lists_runtime, lists_backup;\n"
        "ALTER DEFAULT PRIVILEGES FOR ROLE lists_migrator IN SCHEMA public "
        "GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lists_runtime;\n"
        "ALTER DEFAULT PRIVILEGES FOR ROLE lists_migrator IN SCHEMA public "
        "GRANT SELECT ON TABLES TO lists_backup;\n" + BACKUP_SEQUENCE_GRANTS,
    )


def render_environments(values):
    url = lambda role, password: (
        f"postgresql://{role}:{quote(password, safe='')}@postgres:5432/lists_service"
    )
    return {
        "runtime.env": "\n".join((
            "SECRET_PROVIDER=aws", f"AWS_REGION={REGION}", "HOST=0.0.0.0", "PORT=3000",
            "DATABASE_URL=" + url("lists_runtime", values["PGPASSWORD_RUNTIME"]),
            *(f"{key}={values[key]}" for key in (
                "REST_API_TOKEN_SECRET_ARN", "LIFE2_JWT_SIGNING_KEY_SECRET_ARN",
                "TODOIST_TENANT_CATALOG_SECRET_ARN", "LIFE2_ALLOWED_ACCOUNT_ID",
            )),
        )) + "\n",
        "migration.env": "DATABASE_URL=" + url("lists_migrator", values["PGPASSWORD_MIGRATOR"]) + "\n",
        "backup.env": "\n".join((
            "PGHOST_HELPER=127.0.0.1", "PGDATABASE=lists_service",
            "PGUSER_BACKUP=lists_backup", "PGPASSWORD_BACKUP=" + values["PGPASSWORD_BACKUP"],
            "PGUSER_RESTORE=lists_restore", "PGPASSWORD_RESTORE=" + values["PGPASSWORD_RESTORE"],
        )) + "\n",
    }


def require_unused_target(database_exists, role_exists):
    if database_exists or role_exists:
        raise ValueError("Lists database or role already exists; reconcile manually without dropping data")


def _admin_sql(sql, *, database="postgres"):
    result = subprocess.run(
        [DOCKER, "exec", "-i", "-u", "postgres", "postgres", "psql", "-X", "-A", "-t",
         "-v", "ON_ERROR_STOP=1", "-d", database],
        input=sql.encode("utf-8"), stdout=subprocess.PIPE, stderr=subprocess.PIPE,
        timeout=30, check=False,
    )
    if result.returncode:
        raise ValueError("PostgreSQL provision command failed; inspect host logs privately")
    return result.stdout.decode("ascii").strip()


def _check_installed():
    if os.geteuid() != 0 or pathlib.Path(__file__).resolve() != INSTALLED:
        raise ValueError("root-owned installed provisioner required")
    for source in (INSTALLED, INSTALLED.parent / "release_contract.py"):
        metadata = source.lstat()
        if (not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
            or metadata.st_gid != 0 or metadata.st_nlink != 1
            or stat.S_IMODE(metadata.st_mode) != 0o755):
            raise ValueError("root-owned installed provisioner required")
    parent = SHARED.lstat()
    if (not stat.S_ISDIR(parent.st_mode) or parent.st_uid != 0 or parent.st_gid != 0
        or stat.S_IMODE(parent.st_mode) != 0o700):
        raise ValueError("root-only Lists shared directory required")


def apply(values):
    for name in ("runtime.env", "migration.env", "backup.env"):
        if (SHARED / name).exists() or (SHARED / name).is_symlink():
            raise ValueError("protected candidate environment already exists")
    state = _admin_sql(
        "SELECT (SELECT count(*) FROM pg_database WHERE datname = 'lists_service')::text "
        "|| ',' || (SELECT count(*) FROM pg_roles WHERE rolname IN "
        "('lists_runtime','lists_migrator','lists_backup','lists_restore'))::text;"
    )
    if not re.fullmatch(r"[0-9]+,[0-9]+", state):
        raise ValueError("PostgreSQL target preflight is invalid")
    database_count, role_count = (int(part) for part in state.split(","))
    require_unused_target(database_count > 0, role_count > 0)
    phases = sql_phases(values)
    _admin_sql(phases[0])
    _admin_sql(phases[1])
    _admin_sql(phases[2], database="lists_service")
    rendered = render_environments(values)
    for name, content in rendered.items():
        path = SHARED / name
        fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
        with os.fdopen(fd, "w", encoding="utf-8") as output:
            output.write(content)
            output.flush()
            os.fsync(output.fileno())
        load_protected_env(path, name.removesuffix(".env"))
    directory = os.open(SHARED, os.O_RDONLY)
    try:
        os.fsync(directory)
    finally:
        os.close(directory)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=pathlib.Path)
    parser.add_argument("--apply", action="store_true")
    parser.add_argument("--acknowledge-restore-createdb", action="store_true")
    args = parser.parse_args()
    try:
        _check_installed()
        if args.input != SHARED / "provision.env":
            raise ValueError("fixed protected provision input required")
        values = load_input(args.input)
        if args.apply:
            if not args.acknowledge_restore_createdb:
                raise ValueError("restore CREATEDB grant requires explicit acknowledgement")
            apply(values)
            print("lists_database=provisioned; protected_env=written; ingress=unchanged")
        else:
            print("lists_database_plan=valid; restore_createdb=requires_acknowledgement; ingress=unchanged")
    except (OSError, ValueError, subprocess.SubprocessError):
        parser.exit(1, "lists_database_provision=failed; inspect protected state before retry\n")


if __name__ == "__main__":
    main()
