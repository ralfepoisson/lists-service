"""Real PostgreSQL fencing prevents consent state from crossing an old-code rollback."""
import os
import pathlib
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
from urllib.parse import urlsplit

ROOT=pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'deploy/ec2'))
import host_candidate


class LegacyIngressRecoveryTest(unittest.TestCase):
    def test_failed_candidate_stops_before_legacy_route_is_restored(self):
        with tempfile.TemporaryDirectory() as directory:
            site=pathlib.Path(directory)/'site';site.write_bytes(b'new')
            def stop(*args,**kwargs):
                self.assertEqual(site.read_bytes(),b'new')
                self.assertEqual(args[-2:],('stop','api'))
            with patch.object(host_candidate,'_compose',side_effect=stop) as compose,patch.object(host_candidate,'_run'):
                host_candidate.restore_ingress_after_failure(site,b'old',legacy=True,project='component',compose_file='compose')
            compose.assert_called_once()
            self.assertEqual(site.read_bytes(),b'old')


@unittest.skipUnless(os.environ.get('LISTS_TEST_DATABASE_URL'),'disposable PostgreSQL required')
class RealCredentialCutoverFenceTest(unittest.TestCase):
    def setUp(self):
        self.url=os.environ['LISTS_TEST_DATABASE_URL'];self.parsed=urlsplit(self.url)
        self.assertEqual(self.parsed.path,'/postgres');self.assertNotEqual(self.parsed.port,5432)
        self.psql=pathlib.Path(os.environ['POSTGRES_BIN_DIR'])/'psql'
    def query(self,sql,check=True):
        return subprocess.run([str(self.psql),'-X','-A','-t','-v','ON_ERROR_STOP=1','-d',self.url,'-c',sql],capture_output=True,text=True,check=check)
    def test_exact_new_table_writes_wait_and_resume_after_success(self):
        with host_candidate.fence_legacy_credential_writes({'DATABASE_URL':self.url},psql=self.psql):
            result=self.query("BEGIN; SET LOCAL lock_timeout='100ms'; INSERT INTO lists_todoist_connections(account_id,encrypted_token,version,updated_by) VALUES('release-fence-fixture',NULL,1,'unit'); ROLLBACK;",check=False)
            self.assertNotEqual(result.returncode,0);self.assertIn('lock timeout',result.stderr)
        self.query("BEGIN; INSERT INTO lists_todoist_connections(account_id,encrypted_token,version,updated_by) VALUES('release-fence-fixture',NULL,1,'unit'); ROLLBACK;")
    def test_existing_disconnection_state_refuses_legacy_selection(self):
        self.query("INSERT INTO lists_todoist_connections(account_id,encrypted_token,version,updated_by) VALUES('release-fence-fixture',NULL,1,'unit')")
        try:
            with self.assertRaises(host_candidate.CandidateFailure):
                with host_candidate.fence_legacy_credential_writes({'DATABASE_URL':self.url},psql=self.psql):pass
        finally:self.query("DELETE FROM lists_todoist_connections WHERE account_id='release-fence-fixture'")
