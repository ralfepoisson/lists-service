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
