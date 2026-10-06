#!/usr/bin/env python3
"""Trusted, candidate-only Lists release on the existing EC2 PostgreSQL network.

This file must be installed separately as root-owned host tooling. Uploaded
release data is never executed. An accepted 0.10 upgrade may change only the
two existing Lists Apache loopback targets; ALB, DNS and Lambda are preserved.
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
from urllib.parse import quote, urlsplit

from backup_restore import perform_backup_restore
from release_contract import ACCOUNT, IMAGE_PREFIX, REGION, UPGRADE_MIGRATIONS, UPGRADE_VERSION, load_protected_env, parse_manifest


APP_ROOT = pathlib.Path("/srv/apps/life2-lists")
INSTALLED_ROOT = pathlib.Path("/usr/local/libexec/life2-lists")
DOCKER = "/usr/bin/docker"
AWS = "/usr/bin/aws"
PORTS = (43240, 43241)


class CandidateFailure(Exception):
    pass


def render_compose(*, image, runtime_env, migration_env, port, ingress_network=None):
    if not isinstance(image, str) or not re.fullmatch(
        re.escape(IMAGE_PREFIX) + r"[0-9a-f]{64}", image
    ) or port not in PORTS:
        raise ValueError("candidate image or port is invalid")
    if ingress_network is not None and not re.fullmatch(r"life2-lists-[0-9a-f]{12}_ingress", ingress_network):
        raise ValueError("upgrade ingress network is not component-owned")
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
                "restart": "unless-stopped",
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
            "ingress": {"driver": "bridge"} if ingress_network is None else {"external": True, "name": ingress_network},
        },
    }


def render_ingress_upgrade(previous, port):
    if not isinstance(previous, bytes) or port not in PORTS or previous.count(b"ServerName lists.life-sqrd.com") != 1:
        raise ValueError("Lists ingress identity is invalid")
    targets = re.findall(rb"http://127\.0\.0\.1:(4324[01])/", previous)
    if len(targets) != 2 or targets[0] != targets[1] or int(targets[0]) == port:
        raise ValueError("Lists ingress targets are not the accepted old route")
    return previous.replace(b"http://127.0.0.1:" + targets[0] + b"/", ("http://127.0.0.1:" + str(port) + "/").encode())


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
    migrations = manifest.get("migrations", {manifest.get("migration"): manifest.get("migrationSha256")})
    for name, checksum in migrations.items():
        output = _run([DOCKER, "run", "--rm", "--network", "none", "--entrypoint", "sha256sum", image, "/app/migrations/" + name])
        if output.decode("ascii").split()[0] != checksum:
            raise CandidateFailure("candidate migration content differs from manifest")



def expected_baseline_tables(baseline, migrations):
    if baseline.get("schemaVersion") == 1 and baseline.get("version") == "0.9.0" and baseline.get("migrationSha256") == migrations.get("001_loops.sql"):
        return 3
    if baseline.get("schemaVersion") == 2 and baseline.get("version") == "0.10.1" and baseline.get("migrations") == migrations:
        return 6
    raise CandidateFailure("retained Lists schema or checksums are not an accepted upgrade baseline")


def _retained_ingress_network(manifest):
    from candidate_smoke import _request, _expect
    identity = _expect(*_request("https://lists.life-sqrd.com", "/version"), 200)
    sha = identity.get("revision")
    if identity.get("version") not in ("0.9.0", "0.10.1") or not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise CandidateFailure("upgrade requires retained public provenance")
    previous = APP_ROOT / "releases" / sha
    _trusted_file(previous / "release.json", 0o600)
    _trusted_file(previous / "compose.generated.json", 0o600)
    baseline = parse_manifest((previous / "release.json").read_bytes())
    if baseline["revision"] != sha or baseline["version"] != identity["version"]:
        raise CandidateFailure("retained release provenance differs")
    tables = expected_baseline_tables(baseline, manifest["migrations"])
    compose = json.loads((previous / "compose.generated.json").read_text())
    ingress = compose["networks"]["ingress"]
    name = ingress.get("name") if ingress.get("external") is True else "life2-lists-" + sha[:12] + "_ingress"
    if not isinstance(name, str) or not re.fullmatch(r"life2-lists-[0-9a-f]{12}_ingress", name):
        raise CandidateFailure("retained Lists ingress identity differs")
    project = name[:-len("_ingress")]
    network = json.loads(_run([DOCKER, "network", "inspect", name]))[0]
    labels = network.get("Labels", {})
    if network.get("Name") != name or network.get("Driver") != "bridge" or network.get("Internal") is not False or labels.get("com.docker.compose.project") != project or labels.get("com.docker.compose.network") != "ingress":
        raise CandidateFailure("retained Lists ingress ownership differs")
    return name, tables


def stage_candidate(staged):
    _require_installed_tools()
    manifest, data = _snapshot_manifest(staged)
    if manifest["schemaVersion"] == 2 and manifest["version"] != UPGRADE_VERSION:
        raise CandidateFailure("candidate must match the reviewed target patch version")
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
    ingress_network, baseline_tables = _retained_ingress_network(manifest) if manifest["schemaVersion"] == 2 else (None, 0)
    compose_file = release / "compose.generated.json"
    compose_file.write_text(json.dumps(render_compose(
        image=manifest["image"], runtime_env=str(runtime),
        migration_env=str(migration), port=port, ingress_network=ingress_network,
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
        def rehearse(scratch):
            environment = release / "restore-rehearsal.env"
            password = quote(backup_values["PGPASSWORD_RESTORE"], safe="")
            environment.write_text("DATABASE_URL=postgresql://" + backup_values["PGUSER_RESTORE"] + ":" + password + "@postgres:5432/" + scratch + "\n")
            environment.chmod(0o600)
            try:
                _run([DOCKER, "run", "--rm", "--network", "personal-projects-postgresql", "--env-file", str(environment), manifest["image"], "node", "migrate.cjs"], timeout=180)
                _run([DOCKER, "run", "--rm", "--network", "personal-projects-postgresql", "--env-file", str(environment), manifest["image"], "node", "migrate.cjs"], timeout=180)
            finally:
                environment.unlink(missing_ok=True)
        backup_result = perform_backup_restore(
            host=backup_values["PGHOST_HELPER"], port=5432,
            database=backup_values["PGDATABASE"],
            backup_user=backup_values["PGUSER_BACKUP"],
            backup_password=backup_values["PGPASSWORD_BACKUP"],
            restore_user=backup_values["PGUSER_RESTORE"],
            restore_password=backup_values["PGPASSWORD_RESTORE"],
            backup_path=backup, bin_dir=pathlib.Path("/usr/bin"),
            rehearsal=rehearse if manifest["schemaVersion"] == 2 else None,
        )
        if manifest["schemaVersion"] == 1:
            if backup_result["schema_table_count"] != 0 or backup_result["source_counts"] != (None, None):
                raise CandidateFailure("initial Lists database must be empty before migration")
        elif backup_result["schema_table_count"] != baseline_tables or backup_result["source_counts"] == (None, None):
            raise CandidateFailure("upgrade requires the exact retained accepted schema")
        _compose(project, compose_file, "--profile", "migration", "run", "--rm", "migrate", timeout=180)
        started = True
        _compose(project, compose_file, "up", "--detach", "--wait", "--wait-timeout", "120", "api", timeout=180)
        from candidate_smoke import run_smoke
        smoke = run_smoke(
            f"http://127.0.0.1:{port}", shared / "smoke-primary.jwt",
            shared / "smoke-foreign.jwt", expected_revision=sha, expected_uid=0, expected_version=manifest["version"],
        )
        if _alias_version() != initial_alias:
            raise CandidateFailure("active Lambda alias changed during candidate validation")
        result = {
            "schemaVersion": 1, "status": "candidate-validated", "revision": sha,
            "image": manifest["image"], "migrations": manifest.get("migrations", {manifest.get("migration"): manifest.get("migrationSha256")}),
            "restoreRehearsed": manifest["schemaVersion"] == 2,
            "backupSha256": backup_result["sha256"], "aliasVersion": initial_alias,
            "port": port, "composeProject": project, "smoke": smoke,
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


def activate_upgrade(sha):
    _require_installed_tools()
    if not re.fullmatch(r"[0-9a-f]{40}", sha):
        raise CandidateFailure("upgrade revision is invalid")
    release = APP_ROOT / "releases" / sha
    manifest_file, result_file = release / "release.json", release / "candidate-result.json"
    _trusted_file(manifest_file, 0o600)
    _trusted_file(result_file, 0o600)
    manifest = parse_manifest(manifest_file.read_bytes())
    result = json.loads(result_file.read_text())
    if manifest["schemaVersion"] != 2 or manifest["version"] != UPGRADE_VERSION or result.get("status") != "candidate-validated" or result.get("revision") != sha or result.get("image") != manifest["image"] or result.get("restoreRehearsed") is not True:
        raise CandidateFailure("upgrade lacks matching restored candidate acceptance")
    port = result.get("port")
    if port not in PORTS:
        raise CandidateFailure("upgrade candidate port is invalid")
    from candidate_smoke import _request, _expect, load_token
    shared = APP_ROOT / "shared"
    primary = load_token(shared / "smoke-primary.jwt")
    foreign = load_token(shared / "smoke-foreign.jwt")
    def accept(base):
        version = _expect(*_request(base, "/version"), 200)
        if version.get("version") != manifest["version"] or version.get("revision") != sha:
            raise CandidateFailure("upgrade served identity differs")
        _expect(*_request(base, "/health/heartbeat"), 200)
        _expect(*_request(base, "/v1/loops?status=all", token=primary), 200)
        _expect(*_request(base, "/v1/tags", token=primary), 200)
        _expect(*_request(base, "/v1/task-lists", token=primary), 200)
        _expect(*_request(base, "/v1/loops", token="invalid"), 401)
        loop_id = result.get("smoke", {}).get("loopId")
        if not isinstance(loop_id, str) or not re.fullmatch(r"[0-9a-f-]{36}", loop_id):
            raise CandidateFailure("upgrade lacks persisted Loop evidence")
        _expect(*_request(base, "/v1/loops/" + loop_id, token=foreign), 404)
    accept("http://127.0.0.1:" + str(port))
    site = pathlib.Path("/etc/apache2/sites-available/life2-lists.conf")
    _trusted_file(site, 0o644)
    previous = site.read_bytes()
    before = _expect(*_request("https://lists.life-sqrd.com", "/version"), 200)
    if before.get("version") not in ("0.9.0", "0.10.1") or not isinstance(before.get("revision"), str) or not re.fullmatch(r"[0-9a-f]{40}", before["revision"]):
        raise CandidateFailure("upgrade requires the retained accepted public baseline")
    previous_manifest = APP_ROOT / "releases" / before.get("revision", "invalid") / "release.json"
    _trusted_file(previous_manifest, 0o600)
    previous_identity = parse_manifest(previous_manifest.read_bytes())
    if previous_identity["revision"] != before["revision"] or previous_identity["version"] != before["version"]:
        raise CandidateFailure("retained rollback provenance differs")
    expected_baseline_tables(previous_identity, manifest["migrations"])
    changed = render_ingress_upgrade(previous, port)
    backup = release / "apache-before.conf"
    with backup.open("xb") as out:
        out.write(previous)
    backup.chmod(0o600)
    try:
        site.write_bytes(changed)
        _run(["/usr/sbin/apache2ctl", "configtest"])
        _run(["/usr/bin/systemctl", "reload", "apache2"])
        accept("https://lists.life-sqrd.com")
        receipt = {"status": "activated", "revision": sha, "image": manifest["image"], "port": port, "previousRevision": before["revision"], "activatedAt": datetime.now(timezone.utc).isoformat()}
        with (release / "activation.json").open("x") as out:
            json.dump(receipt, out)
        (release / "activation.json").chmod(0o600)
        print("lists_upgrade=activated revision=" + sha)
    except Exception:
        site.write_bytes(previous)
        _run(["/usr/sbin/apache2ctl", "configtest"])
        _run(["/usr/bin/systemctl", "reload", "apache2"])
        raise


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("staged_manifest", type=pathlib.Path, nargs="?")
    parser.add_argument("--activate")
    args = parser.parse_args()
    try:
        if args.activate is not None and args.staged_manifest is None:
            activate_upgrade(args.activate)
        elif args.staged_manifest is not None and args.activate is None:
            stage_candidate(args.staged_manifest)
        else:
            raise CandidateFailure("select one release operation")
    except Exception:
        parser.exit(1, "lists_candidate=failed; active Lambda alias unchanged by this tool\n")


if __name__ == "__main__":
    main()
