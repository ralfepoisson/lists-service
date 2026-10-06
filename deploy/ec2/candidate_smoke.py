#!/usr/bin/env python3
"""Authenticated, tenant-safe HTTP acceptance for a loopback Lists candidate."""

import base64
import json
import os
import pathlib
import re
import secrets
import stat
import time
from urllib.error import HTTPError
from urllib.request import Request, urlopen


def load_token(path, expected_uid=0):
    path = pathlib.Path(path)
    metadata = path.lstat()
    parent = path.parent.lstat()
    if (
        not stat.S_ISREG(metadata.st_mode) or metadata.st_uid != expected_uid
        or metadata.st_nlink != 1 or stat.S_IMODE(metadata.st_mode) != 0o600
        or not stat.S_ISDIR(parent.st_mode) or parent.st_uid != expected_uid
        or stat.S_IMODE(parent.st_mode) & 0o077
        or (expected_uid == 0 and metadata.st_gid != 0)
    ):
        raise ValueError("smoke token has unsafe metadata")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW)
    try:
        opened = os.fstat(fd)
        if opened.st_ino != metadata.st_ino or opened.st_dev != metadata.st_dev:
            raise ValueError("smoke token changed while reading")
        data = os.read(fd, 16385).strip()
    finally:
        os.close(fd)
    if not 32 <= len(data) <= 16384 or not re.fullmatch(
        rb"[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+", data
    ):
        raise ValueError("smoke token shape is invalid")
    try:
        body = data.split(b".")[1]
        claims = json.loads(base64.urlsafe_b64decode(body + b"=" * (-len(body) % 4)))
        expiry = claims.get("exp")
    except (ValueError, IndexError) as exc:
        raise ValueError("smoke token expiry is invalid") from exc
    if type(expiry) not in (int, float) or expiry - time.time() <= 600:
        raise ValueError("smoke token is expired or too near expiry")
    return data.decode("ascii")


def _request(base, path, *, method="GET", token=None, payload=None):
    headers = {"accept": "application/json"}
    if token is not None:
        headers["authorization"] = "Bearer " + token
    body = None
    if payload is not None:
        body = json.dumps(payload, separators=(",", ":")).encode("utf-8")
        headers["content-type"] = "application/json"
    request = Request(base + path, data=body, headers=headers, method=method)
    try:
        with urlopen(request, timeout=10) as response:
            return response.status, json.loads(response.read(1048577))
    except HTTPError as error:
        error.read(1048577)
        return error.code, None


def _expect(status, response, expected):
    if status != expected:
        raise ValueError("candidate HTTP acceptance failed")
    return response


def run_smoke(base, primary_file, foreign_file, *, expected_revision, expected_uid=0, expected_version="0.9.0"):
    if not re.fullmatch(r"http://127\.0\.0\.1:4324[01]", base):
        raise ValueError("candidate smoke must use a fixed loopback port")
    if not re.fullmatch(r"[0-9a-f]{40}", expected_revision):
        raise ValueError("candidate revision is invalid")
    primary = load_token(primary_file, expected_uid=expected_uid)
    foreign = load_token(foreign_file, expected_uid=expected_uid)
    if primary == foreign:
        raise ValueError("candidate smoke requires separate real tenant tokens")
    version = _expect(*_request(base, "/version"), 200)
    if version.get("version") != expected_version or version.get("revision") != expected_revision:
        raise ValueError("candidate served version differs from image")
    _expect(*_request(base, "/health/heartbeat"), 200)
    _expect(*_request(base, "/health/ready", token=primary), 200)
    _expect(*_request(base, "/v1/task-lists", token=primary), 200)
    _expect(*_request(base, "/v1/loops", token="invalid"), 401)
    marker = "Release candidate " + expected_revision[:12] + " " + secrets.token_hex(4)
    created = _expect(*_request(
        base, "/v1/loops", method="POST", token=primary,
        payload={"title": marker, "outcome": "Candidate persistence verified"},
    ), 201)
    loop_id = created.get("data", {}).get("id")
    if not isinstance(loop_id, str) or not re.fullmatch(r"[0-9a-f-]{36}", loop_id):
        raise ValueError("candidate create did not return a Loop identity")
    closed = False
    try:
        path = "/v1/loops/" + loop_id
        retrieved = _expect(*_request(base, path, token=primary), 200)
        if retrieved.get("data", {}).get("title") != marker:
            raise ValueError("candidate Loop persistence did not roundtrip")
        _expect(*_request(base, path, token=foreign), 404)
        changed = _expect(*_request(
            base, path, method="PATCH", token=primary,
            payload={"outcome": "Candidate tenant isolation verified"},
        ), 200)
        if changed.get("data", {}).get("outcome") != "Candidate tenant isolation verified":
            raise ValueError("candidate Loop update did not persist")
        if expected_version in ("0.10.1", "0.10.2"):
            comment = _expect(*_request(base, path + "/comments", method="POST", token=primary, payload={"content": "Release comment persistence verified"}), 201)
            if comment.get("data", {}).get("content") != "Release comment persistence verified":
                raise ValueError("candidate comment did not persist")
            _expect(*_request(base, path + "/comments", token=primary), 200)
            _expect(*_request(base, path + "/comments", token=foreign), 404)
            _expect(*_request(base, "/v1/tags", token=primary), 200)
        result = _expect(*_request(
            base, path + "/close", method="POST", token=primary,
            payload={"confirmed": True},
        ), 200)
        closed = result.get("data", {}).get("status") == "closed"
        if not closed:
            raise ValueError("candidate Loop close did not persist")
        if expected_version in ("0.10.1", "0.10.2"):
            _expect(*_request(base, path + "/comments", method="POST", token=primary, payload={"content": "Closed Loop must reject this comment"}), 409)
    finally:
        if not closed:
            try:
                _request(
                    base, "/v1/loops/" + loop_id + "/close", method="POST",
                    token=primary, payload={"confirmed": True},
                )
            except Exception:
                pass
    return {"candidate": "accepted", "closedLoop": True, "loopId": loop_id}
