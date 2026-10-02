#!/usr/bin/env python3
"""Fail-closed, non-executing contract for a Lists EC2 candidate release."""

import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
from urllib.parse import urlsplit


ACCOUNT = "154596858576"
REGION = "eu-west-1"
VERSION = "0.9.0"
MIGRATION = "001_loops.sql"
IMAGE_PREFIX = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com/life2-lists@sha256:"
MANIFEST_KEYS = {
    "schemaVersion", "component", "version", "revision", "image",
    "migration", "migrationSha256",
}
RUNTIME_ENV = {
    "SECRET_PROVIDER", "AWS_REGION", "HOST", "PORT", "DATABASE_URL",
    "REST_API_TOKEN_SECRET_ARN", "LIFE2_JWT_SIGNING_KEY_SECRET_ARN",
    "TODOIST_TENANT_CATALOG_SECRET_ARN", "LIFE2_ALLOWED_ACCOUNT_ID",
}
MIGRATION_ENV = {"DATABASE_URL"}
BACKUP_ENV = {
    "PGHOST_HELPER", "PGDATABASE", "PGUSER_BACKUP", "PGPASSWORD_BACKUP",
    "PGUSER_RESTORE", "PGPASSWORD_RESTORE",
}
OPTIONAL_RUNTIME_ENV = {"LOG_LEVEL", "COMPLETED_LOOKBACK_DAYS", "TODOIST_API_BASE_URL"}


def validate_manifest(manifest):
    if not isinstance(manifest, dict) or set(manifest) != MANIFEST_KEYS:
        raise ValueError("release manifest has unexpected fields")
    if type(manifest["schemaVersion"]) is not int or manifest["schemaVersion"] != 1:
        raise ValueError("unsupported release manifest schema")
    if manifest["component"] != "lists-service" or manifest["version"] != VERSION:
        raise ValueError("release component or version mismatch")
    if not isinstance(manifest["revision"], str) or not re.fullmatch(
        r"[0-9a-f]{40}", manifest["revision"]
    ):
        raise ValueError("release revision is invalid")
    if not isinstance(manifest["image"], str) or not re.fullmatch(
        re.escape(IMAGE_PREFIX) + r"[0-9a-f]{64}", manifest["image"]
    ):
        raise ValueError("release image must be the exact ECR digest")
    if manifest["migration"] != MIGRATION or not isinstance(
        manifest["migrationSha256"], str
    ) or not re.fullmatch(r"[0-9a-f]{64}", manifest["migrationSha256"]):
        raise ValueError("release migration identity is invalid")


def parse_manifest(data):
    def reject_duplicates(pairs):
        values = {}
        for key, value in pairs:
            if key in values:
                raise ValueError("release manifest has duplicate fields")
            values[key] = value
        return values

    manifest = json.loads(data, object_pairs_hook=reject_duplicates)
    validate_manifest(manifest)
    return manifest


def build_manifest(*, revision, image, migration_file):
    migration_file = pathlib.Path(migration_file)
    if migration_file.name != MIGRATION or not migration_file.is_file():
        raise ValueError("release migration source is invalid")
    manifest = {
        "schemaVersion": 1,
        "component": "lists-service",
        "version": VERSION,
        "revision": revision,
        "image": image,
        "migration": MIGRATION,
        "migrationSha256": hashlib.sha256(migration_file.read_bytes()).hexdigest(),
    }
    validate_manifest(manifest)
    return manifest


def _validate_database_url(value, name):
    try:
        parsed = urlsplit(value)
        port = parsed.port
    except ValueError as exc:
        raise ValueError(f"{name} is invalid") from exc
    if (
        parsed.scheme != "postgresql"
        or parsed.hostname != "postgres"
        or port != 5432
        or parsed.path != "/lists_service"
        or parsed.username is None
        or parsed.password is None
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"{name} must target the private Lists PostgreSQL database")


def load_protected_env(path, kind, expected_uid=0):
    if kind not in ("runtime", "migration", "backup"):
        raise ValueError("unknown protected environment kind")
    required = {
        "runtime": RUNTIME_ENV, "migration": MIGRATION_ENV, "backup": BACKUP_ENV,
    }[kind]
    optional = OPTIONAL_RUNTIME_ENV if kind == "runtime" else set()
    path = pathlib.Path(path)
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode)
        or metadata.st_uid != expected_uid
        or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != 0o600
        or (expected_uid == 0 and metadata.st_gid != 0)
    ):
        raise ValueError("candidate environment has unsafe metadata")
    parent = path.parent.lstat()
    if (
        not stat.S_ISDIR(parent.st_mode)
        or parent.st_uid != expected_uid
        or stat.S_IMODE(parent.st_mode) & 0o077
    ):
        raise ValueError("candidate environment parent is not private")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        with os.fdopen(fd, "r", encoding="utf-8") as source:
            opened = os.fstat(source.fileno())
            if opened.st_ino != metadata.st_ino or opened.st_dev != metadata.st_dev:
                raise ValueError("candidate environment changed while reading")
            content = source.read(16385)
    except UnicodeDecodeError as exc:
        raise ValueError("candidate environment must be UTF-8") from exc
    if not 1 <= len(content) <= 16384 or "\x00" in content:
        raise ValueError("candidate environment size or content is invalid")
    values = {}
    for line in content.splitlines():
        if not line or "=" not in line:
            raise ValueError("candidate environment contains an invalid line")
        key, value = line.split("=", 1)
        if key not in required | optional or key in values or not value:
            raise ValueError("candidate environment has missing or unexpected values")
        if any(character.isspace() for character in value) or any(
            character in value for character in ("`", "$", "#", "\\", "'", '"')
        ):
            raise ValueError("candidate environment contains executable syntax")
        values[key] = value
    if not required <= values.keys():
        raise ValueError("candidate environment is incomplete")
    if kind == "runtime":
        if values["SECRET_PROVIDER"] != "aws" or values["AWS_REGION"] != REGION:
            raise ValueError("candidate secret provider or region is invalid")
        if values["HOST"] != "0.0.0.0" or values["PORT"] != "3000":
            raise ValueError("candidate listener configuration is invalid")
        arn_pattern = rf"arn:aws:secretsmanager:{REGION}:{ACCOUNT}:secret:[A-Za-z0-9/_+=.@-]+"
        for name in (
            "REST_API_TOKEN_SECRET_ARN", "LIFE2_JWT_SIGNING_KEY_SECRET_ARN",
            "TODOIST_TENANT_CATALOG_SECRET_ARN",
        ):
            if not re.fullmatch(arn_pattern, values[name]):
                raise ValueError(f"{name} must be an in-account Secrets Manager ARN")
    if kind in ("runtime", "migration"):
        _validate_database_url(values["DATABASE_URL"], "DATABASE_URL")
    if kind == "backup" and (
        values["PGHOST_HELPER"] != "127.0.0.1" or values["PGDATABASE"] != "lists_service"
    ):
        raise ValueError("candidate backup database configuration is invalid")
    return values


def main():
    parser = argparse.ArgumentParser()
    subcommands = parser.add_subparsers(dest="command", required=True)
    manifest_command = subcommands.add_parser("validate-manifest")
    manifest_command.add_argument("path", type=pathlib.Path)
    env_command = subcommands.add_parser("validate-env")
    env_command.add_argument("kind", choices=("runtime", "migration", "backup"))
    env_command.add_argument("path", type=pathlib.Path)
    emit_command = subcommands.add_parser("emit-manifest")
    emit_command.add_argument("revision")
    emit_command.add_argument("image")
    emit_command.add_argument("migration_file", type=pathlib.Path)
    emit_command.add_argument("output", type=pathlib.Path)
    args = parser.parse_args()
    try:
        if args.command == "validate-manifest":
            parse_manifest(args.path.read_bytes())
            print("manifest=valid")
        elif args.command == "validate-env":
            load_protected_env(args.path, args.kind)
            print("candidate_env=valid")
        else:
            manifest = build_manifest(
                revision=args.revision, image=args.image,
                migration_file=args.migration_file,
            )
            fd = os.open(args.output, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
            with os.fdopen(fd, "w", encoding="utf-8") as target:
                json.dump(manifest, target, separators=(",", ":"))
                target.write("\n")
                target.flush()
                os.fsync(target.fileno())
            print("manifest=written")
    except (OSError, ValueError, json.JSONDecodeError) as exc:
        parser.exit(1, f"release_contract: {exc}\n")


if __name__ == "__main__":
    main()
