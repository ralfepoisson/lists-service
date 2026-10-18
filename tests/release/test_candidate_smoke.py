import base64
import importlib.util
import json
import os
import pathlib
import sys
import tempfile
import time
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "ec2"))
SPEC = importlib.util.spec_from_file_location(
    "candidate_smoke", ROOT / "deploy" / "ec2" / "candidate_smoke.py"
)
candidate_smoke = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(candidate_smoke)


def jwt(expiry):
    body = base64.urlsafe_b64encode(json.dumps({"exp": expiry}).encode()).rstrip(b"=").decode()
    return "e30." + body + ".signature"


class CandidateSmokeTokenTest(unittest.TestCase):
    def test_protected_token_must_have_more_than_ten_minutes_remaining(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "token.jwt"
            path.write_text(jwt(int(time.time()) + 900) + "\n")
            path.chmod(0o600)
            self.assertTrue(candidate_smoke.load_token(path, expected_uid=os.getuid()))
            path.write_text(jwt(int(time.time()) + 300))
            with self.assertRaises(ValueError):
                candidate_smoke.load_token(path, expected_uid=os.getuid())

    def test_unprotected_or_linked_token_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "token.jwt"
            path.write_text(jwt(int(time.time()) + 900))
            path.chmod(0o644)
            with self.assertRaises(ValueError):
                candidate_smoke.load_token(path, expected_uid=os.getuid())
            path.chmod(0o600)
            link = pathlib.Path(directory) / "link.jwt"
            link.symlink_to(path)
            with self.assertRaises(ValueError):
                candidate_smoke.load_token(link, expected_uid=os.getuid())


if __name__ == "__main__":
    unittest.main()


class MembershipPatchSmokeTest(unittest.TestCase):
    def test_membership_patch_keeps_full_heartbeat_browser_comments_and_tags_gates(self):
        from unittest.mock import patch
        calls = []
        def request(base, path, **kwargs):
            calls.append((path, kwargs))
            if path == "/version": return 200, {"version": "0.10.6", "revision": "a" * 40}
            if path == "/health/heartbeat": return 200, {"status": "healthy", "component": "lists-service"}
            if kwargs.get("token") == "invalid": return 401, {}
            if kwargs.get("token") == "foreign": return 404, {}
            if path.endswith("/comments") and kwargs.get("method") == "POST":
                if any(p.endswith("/close") for p, _ in calls): return 409, {}
                return 201, {"data": {"content": "Release comment persistence verified"}}
            if path.endswith("/close"): return 200, {"data": {"status": "closed"}}
            if path == "/v1/loops" and kwargs.get("method") == "POST": return 201, {"data": {"id": "b" * 8 + "-" + "b" * 4 + "-" + "b" * 4 + "-" + "b" * 4 + "-" + "b" * 12}}
            if kwargs.get("method") == "PATCH": return 200, {"data": {"outcome": "Candidate tenant isolation verified"}}
            if path.startswith("/v1/loops/") and not path.endswith("comments"): return 200, {"data": {"title": "Release candidate aaaaaaaaaaaa marker"}}
            return 200, {}
        with patch.object(candidate_smoke, "load_token", side_effect=["primary", "foreign"]), patch.object(candidate_smoke, "_request", side_effect=request), patch.object(candidate_smoke.secrets, "token_hex", return_value="marker"), patch.object(candidate_smoke, "browser_acceptance") as browser:
            candidate_smoke.run_smoke("http://127.0.0.1:43240", "primary", "foreign", expected_revision="a" * 40, expected_version="0.10.6")
        browser.assert_called_once()
        self.assertTrue(any(path == "/v1/tags" for path, _ in calls))
        self.assertTrue(any(path.endswith("/comments") and kwargs.get("method") == "POST" for path, kwargs in calls))
