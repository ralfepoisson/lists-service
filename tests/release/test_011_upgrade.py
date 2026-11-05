"""The 0.11 target must carry the new store without weakening retained provenance."""
import hashlib
import pathlib
import sys
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deploy/ec2'))
import host_candidate
import release_contract


class TodoistUpgradeReleaseTest(unittest.TestCase):
    def target_migrations(self):
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / 'migrations').glob('*.sql')}

    def test_target_manifest_binds_all_six_committed_migrations(self):
        target = release_contract.build_upgrade_manifest(revision='a'*40, image=release_contract.IMAGE_PREFIX+'b'*64, migrations_dir=ROOT/'migrations')
        self.assertEqual(target['version'], '0.11.0')
        self.assertEqual(target['migrations'], self.target_migrations())

    def test_retained_0106_baseline_requires_exact_first_five_checksums(self):
        target=self.target_migrations(); old={k:v for k,v in target.items() if not k.startswith('006_')}
        retained={'schemaVersion':2,'version':'0.10.6','migrations':old}
        self.assertEqual(host_candidate.expected_baseline_tables(retained,target),6)
        release_contract.validate_manifest({**retained,'component':'lists-service','revision':'a'*40,'image':release_contract.IMAGE_PREFIX+'b'*64})
        bad={**retained,'migrations':{**old,'001_loops.sql':'c'*64}}
        with self.assertRaises(host_candidate.CandidateFailure):host_candidate.expected_baseline_tables(bad,target)

    def test_current_011_schema_has_seven_tables_with_exact_all_six_checksums(self):
        target=self.target_migrations()
        self.assertEqual(host_candidate.expected_baseline_tables({'schemaVersion':2,'version':'0.11.0','migrations':target},target),7)

    def test_new_key_preflight_reads_exact_secret_arn_without_returning_value(self):
        values={k:'arn:aws:secretsmanager:eu-west-1:154596858576:secret:'+k for k in ('REST_API_TOKEN_SECRET_ARN','LIFE2_JWT_SIGNING_KEY_SECRET_ARN','TODOIST_TENANT_CATALOG_SECRET_ARN','TODOIST_CONNECTION_KEY_SECRET_ARN')}
        with patch.object(host_candidate,'_run',side_effect=[(v+'\n').encode() for v in values.values()]) as run:
            host_candidate._verify_secret_access(values)
        self.assertEqual(run.call_count,4)
        self.assertTrue(all('--query' in c.args[0] and c.args[0][c.args[0].index('--query')+1]=='ARN' for c in run.call_args_list))

    def test_protected_runtime_key_arn_is_bounded_to_the_existing_account(self):
        import os
        import tempfile
        from database_provision import render_environments
        from test_database_provision import inputs
        with tempfile.TemporaryDirectory() as directory:
            path=pathlib.Path(directory)/'runtime.env'
            content=render_environments(inputs())['runtime.env']
            key='arn:aws:secretsmanager:eu-west-1:154596858576:secret:life2/lists/prod/connection-key'
            path.write_text(content+'TODOIST_CONNECTION_KEY_SECRET_ARN='+key+'\n');path.chmod(0o600)
            values=release_contract.load_protected_env(path,'runtime',expected_uid=os.getuid())
            self.assertEqual(values['TODOIST_CONNECTION_KEY_SECRET_ARN'],key)
            path.write_text(content+'TODOIST_CONNECTION_KEY_SECRET_ARN='+key.replace('154596858576','000000000000')+'\n')
            with self.assertRaises(ValueError):release_contract.load_protected_env(path,'runtime',expected_uid=os.getuid())
