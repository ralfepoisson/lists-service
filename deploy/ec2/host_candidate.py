#!/usr/bin/env python3
"""Trusted, candidate-only Lists release on the existing EC2 PostgreSQL network.

This file must be installed separately as root-owned host tooling. Uploaded
release data is never executed. It does not modify Apache, ALB, DNS or Lambda.
"""

import argparse
import json
import os
import pathlib
import re
import socket
import stat
import subprocess
import sys
from datetime import datetime, timezone
from urllib.parse import urlsplit

from backup_restore import perform_backup_restore
from release_contract import ACCOUNT, IMAGE_PREFIX, REGION, load_protected_env, parse_manifest


APP_ROOT = pathlib.Path("/srv/apps/life2-lists")
INSTALLED_ROOT = pathlib.Path("/usr/local/libexec/life2-lists")
DOCKER = "/usr/bin/docker"
AWS = "/usr/bin/aws"
PORTS = (43240, 43241)


class CandidateFailure(Exception):
    pass


def render_compose(*, image, runtime_env, migration_env, port):
    if not isinstance(image, str) or not re.fullmatch(
        re.escape(IMAGE_PREFIX) + r"[0-9a-f]{64}", image
    ) or port not in PORTS:
        raise ValueError("candidate image or port is invalid")
    for candidate in (runtime_env, migration_env):
        if not isinstance(candidate, str) or not candidate.startswith(
            str(APP_ROOT / "shared") + "/"
        ) or ".." in pathlib.PurePath(candidate).parts:
            raise ValueError("candidate environment path is invalid")
    common = {
        "image": image,
        "read_only": True,
        "security_opt": ["no-new-privileges:true"],
        "cap_drop": ["ALL"],
        "tmpfs": ["/tmp:rw,noexec,nosuid,size=16m"],
    }
    return {
        "services": {
            "migrate": {
                **common,
                "profiles": ["migration"],
                "command": ["node", "migrate.cjs"],
                "env_file": [migration_env],
                "networks": ["postgresql"],
            },
            "api": {
                **common,
                "command": ["node", "local-rest.cjs"],
                "env_file": [runtime_env],
                "ports": [f"127.0.0.1:{port}:3000"],
                "networks": ["postgresql", "ingress"],
                "healthcheck": {
                    "test": [
                        "CMD", "node", "-e",
                        "fetch('http://127.0.0.1:3000/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))",
                    ],
                    "interval": "10s", "timeout": "5s", "retries": 12,
                },
            },
        },
        "networks": {
            "postgresql": {"external": True, "name": "personal-projects-postgresql"},
            "ingress": {"driver": "bridge"},
        },
    }


def _trusted_file(path, mode):
    metadata = path.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != 0
        or metadata.st_gid != 0 or metadata.st_nlink != 1
        or stat.S_IMODE(metadata.st_mode) != mode
    ):
        raise CandidateFailure("trusted host file metadata is invalid")


def _require_installed_tools():
    if os.geteuid() != 0 or pathlib.Path(__file__).resolve() != INSTALLED_ROOT / "host_candidate.py":
        raise CandidateFailure("candidate helper is not installed as root")
    for name in (
        "host_candidate.py", "release_contract.py", "backup_restore.py", "candidate_smoke.py"
    ):
        _trusted_file(INSTALLED_ROOT / name, 0o755)
    _trusted_file(pathlib.Path("/usr/local/sbin/life2-lists-candidate"), 0o755)
    for name in (DOCKER, AWS, "/usr/bin/pg_dump", "/usr/bin/pg_restore", "/usr/bin/createdb", "/usr/bin/dropdb", "/usr/bin/psql"):
        if not pathlib.Path(name).is_file():
            raise CandidateFailure("required fixed host tool is absent")


def _run(arguments, *, stdin=None, timeout=180):
    try:
        return subprocess.run(
            arguments, input=stdin, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
            check=True, timeout=timeout,
        ).stdout
    except (OSError, subprocess.SubprocessError) as exc:
        raise CandidateFailure("candidate command failed") from exc


def _snapshot_manifest(staged):
    if not re.fullmatch(r"/tmp/life2-lists-release-[0-9a-f]{40}/release\.json", str(staged)):
        raise CandidateFailure("untrusted release staging path")
    parent = staged.parent.lstat()
    metadata = staged.lstat()
    if (
        not stat.S_ISDIR(parent.st_mode) or stat.S_IMODE(parent.st_mode) != 0o700
        or not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != parent.st_uid
        or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600
    ):
        raise CandidateFailure("release staging metadata is invalid")
    fd = os.open(staged, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if opened.st_ino != metadata.st_ino or opened.st_dev != metadata.st_dev:
            raise CandidateFailure("release staging file changed")
        data = os.read(fd, 16385)
    finally:
        os.close(fd)
    if not 1 <= len(data) <= 16384:
        raise CandidateFailure("release manifest size is invalid")
    try:
        manifest = parse_manifest(data)
    except (UnicodeDecodeError, ValueError, json.JSONDecodeError) as exc:
        raise CandidateFailure("release manifest is invalid") from exc
    if staged.parent.name != "life2-lists-release-" + manifest["revision"]:
        raise CandidateFailure("release staging identity mismatch")
    return manifest, data


def _alias_version():
    output = _run([
        AWS, "lambda", "get-alias", "--region", REGION,
        "--function-name", "life2-lists-service-prod-rest", "--name", "active",
        "--query", "FunctionVersion", "--output", "text",
    ])
    version = output.decode("ascii").strip()
    if not re.fullmatch(r"[1-9][0-9]*", version):
        raise CandidateFailure("active Lambda alias is unavailable")
    return version


def _verify_secret_access(runtime_values):
    for key in (
        "REST_API_TOKEN_SECRET_ARN", "LIFE2_JWT_SIGNING_KEY_SECRET_ARN",
        "TODOIST_TENANT_CATALOG_SECRET_ARN",
    ):
        arn = runtime_values[key]
        output = _run([
            AWS, "secretsmanager", "get-secret-value", "--region", REGION,
            "--secret-id", arn, "--query", "ARN", "--output", "text",
        ])
        if output.decode("ascii").strip() != arn:
            raise CandidateFailure("Lists protected secret access is unavailable")


def _available_port():
    for port in PORTS:
        with socket.socket() as probe:
            if probe.connect_ex(("127.0.0.1", port)) != 0:
                return port
    raise CandidateFailure("both Lists candidate ports are occupied")


def _compose(project, file, *arguments, timeout=180):
    return _run([
        DOCKER, "compose", "--project-name", project, "--file", str(file), *arguments,
    ], timeout=timeout)


def _verify_image(manifest):
    image = manifest["image"]
    registry = f"{ACCOUNT}.dkr.ecr.{REGION}.amazonaws.com"
    password = _run([AWS, "ecr", "get-login-password", "--region", REGION])
    _run([DOCKER, "login", "--username", "AWS", "--password-stdin", registry], stdin=password)
    _run([DOCKER, "pull", image], timeout=900)
    inspection = json.loads(_run([DOCKER, "image", "inspect", image, "--format", "{{json .}}"] ))
    labels = inspection.get("Config", {}).get("Labels", {})
    if (
        inspection.get("Os") != "linux" or inspection.get("Architecture") != "arm64"
        or image not in inspection.get("RepoDigests", [])
        or labels.get("org.opencontainers.image.revision") != manifest["revision"]
        or labels.get("org.opencontainers.image.version") != manifest["version"]
    ):
        raise CandidateFailure("candidate image identity does not match its manifest")
    output = _run([
        DOCKER, "run", "--rm", "--network", "none", "--entrypoint", "sha256sum",
        image, "/app/migrations/001_loops.sql",
    ])
    if output.decode("ascii").split()[0] != manifest["migrationSha256"]:
        raise CandidateFailure("candidate migration content differs from manifest")


def stage_candidate(staged):
    _require_installed_tools()
    manifest, data = _snapshot_manifest(staged)
    if _run([AWS, "sts", "get-caller-identity", "--query", "Account", "--output", "text"]).decode().strip() != ACCOUNT:
        raise CandidateFailure("AWS account identity mismatch")
    shared = APP_ROOT / "shared"
    for directory, mode in (
        (APP_ROOT, 0o750), (shared, 0o700),
        (APP_ROOT / "releases", 0o700), (APP_ROOT / "backups", 0o750),
    ):
        metadata = directory.lstat()
        if (
            not stat.S_ISDIR(metadata.st_mode) or metadata.st_uid != 0
            or metadata.st_gid != 0 or stat.S_IMODE(metadata.st_mode) != mode
        ):
            raise CandidateFailure("protected Lists directory metadata is invalid")
    runtime = shared / "runtime.env"
    migration = shared / "migration.env"
    backup_env = shared / "backup.env"
    runtime_values = load_protected_env(runtime, "runtime")
    migration_values = load_protected_env(migration, "migration")
    backup_values = load_protected_env(backup_env, "backup")
    if urlsplit(runtime_values["DATABASE_URL"]).username == urlsplit(
        migration_values["DATABASE_URL"]
    ).username:
        raise CandidateFailure("runtime and migration database roles must differ")
    if backup_values["PGUSER_BACKUP"] == backup_values["PGUSER_RESTORE"]:
        raise CandidateFailure("backup and restore database roles must differ")
    _verify_secret_access(runtime_values)
    initial_alias = _alias_version()
    port = _available_port()
    sha = manifest["revision"]
    release = APP_ROOT / "releases" / sha
    release.mkdir(mode=0o700)
    manifest_copy = release / "release.json"
    with manifest_copy.open("xb") as target:
        target.write(data)
    manifest_copy.chmod(0o600)
    compose_file = release / "compose.generated.json"
    compose_file.write_text(json.dumps(render_compose(
        image=manifest["image"], runtime_env=str(runtime),
        migration_env=str(migration), port=port,
    ), separators=(",", ":")), encoding="utf-8")
    compose_file.chmod(0o600)
    project = "life2-lists-" + sha[:12]
    started = False
    try:
        _verify_image(manifest)
        _compose(project, compose_file, "config", "--quiet")
        backups = APP_ROOT / "backups"
        if not backups.is_dir():
            raise CandidateFailure("protected Lists backup directory is absent")
        backup = backups / (sha + "-" + datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ") + ".dump")
        backup_result = perform_backup_restore(
            host=backup_values["PGHOST_HELPER"], port=5432,
            database=backup_values["PGDATABASE"],
            backup_user=backup_values["PGUSER_BACKUP"],
            backup_password=backup_values["PGPASSWORD_BACKUP"],
            restore_user=backup_values["PGUSER_RESTORE"],
            restore_password=backup_values["PGPASSWORD_RESTORE"],
            backup_path=backup, bin_dir=pathlib.Path("/usr/bin"),
        )
        if backup_result["schema_table_count"] != 0 or backup_result["source_counts"] != (None, None):
            raise CandidateFailure("initial Lists database must be empty before migration")
        _compose(project, compose_file, "--profile", "migration", "run", "--rm", "migrate", timeout=180)
        started = True
        _compose(project, compose_file, "up", "--detach", "--wait", "--wait-timeout", "120", "api", timeout=180)
        from candidate_smoke import run_smoke
        run_smoke(
            f"http://127.0.0.1:{port}", shared / "smoke-primary.jwt",
            shared / "smoke-foreign.jwt", expected_revision=sha, expected_uid=0,
        )
        if _alias_version() != initial_alias:
            raise CandidateFailure("active Lambda alias changed during candidate validation")
        result = {
            "schemaVersion": 1, "status": "candidate-validated", "revision": sha,
            "image": manifest["image"], "migrationSha256": manifest["migrationSha256"],
            "backupSha256": backup_result["sha256"], "aliasVersion": initial_alias,
            "port": port, "composeProject": project,
            "validatedAt": datetime.now(timezone.utc).isoformat(),
        }
        with (release / "candidate-result.json").open("x", encoding="utf-8") as target:
            json.dump(result, target, separators=(",", ":"))
        (release / "candidate-result.json").chmod(0o600)
        print("lists_candidate=validated revision=" + sha)
    except Exception:
        if started:
            try:
                _compose(project, compose_file, "down", timeout=120)
            except CandidateFailure:
                pass
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("staged_manifest", type=pathlib.Path)
    args = parser.parse_args()
    try:
        stage_candidate(args.staged_manifest)
    except Exception:
        parser.exit(1, "lists_candidate=failed; active Lambda alias unchanged by this tool\n")


if __name__ == "__main__":
    main()
