"""UNIT release contract: 0.12 binds 007 while preserving exact 0.11 recovery."""
import hashlib
import pathlib
import sys
import unittest

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'deploy/ec2'))
import host_candidate
import release_contract


class CalendarUpgradeReleaseTest(unittest.TestCase):
    def migrations(self):
        return {p.name: hashlib.sha256(p.read_bytes()).hexdigest() for p in (ROOT / 'migrations').glob('*.sql')}

    def test_target_is_012_and_binds_every_migration_including_007(self):
        target = release_contract.build_upgrade_manifest(revision='a'*40, image=release_contract.IMAGE_PREFIX+'b'*64, migrations_dir=ROOT/'migrations')
        self.assertEqual(target['version'], '0.12.2')
        self.assertEqual(target['migrations'], self.migrations())
        self.assertEqual(host_candidate.expected_baseline_tables(target,target['migrations']),8)

    def test_exact_011_six_migration_baseline_survives_but_mismatch_fails(self):
        target=self.migrations()
        old={k:v for k,v in target.items() if not k.startswith('007_')}
        retained={'schemaVersion':2,'component':'lists-service','version':'0.11.0','revision':'a'*40,'image':release_contract.IMAGE_PREFIX+'b'*64,'migrations':old}
        release_contract.validate_manifest(retained)
        self.assertEqual(host_candidate.expected_baseline_tables(retained,target),7)
        with self.assertRaises(host_candidate.CandidateFailure):
            host_candidate.expected_baseline_tables({**retained,'migrations':{**old,'006_todoist_connections.sql':'c'*64}},target)
        with self.assertRaises(ValueError):
            release_contract.validate_manifest({**retained,'version':'0.12.0'})

    def test_publisher_never_mislabels_012_as_011(self):
        source=(ROOT/'scripts/publish-ec2-candidate.sh').read_text()
        self.assertIn('--build-arg COMPONENT_VERSION=0.12.2',source)

    def test_unselected_candidate_does_not_advertise_a_shared_canonical_alias(self):
        compose=host_candidate.render_compose(image=release_contract.IMAGE_PREFIX+'a'*64, runtime_env='/srv/apps/life2-lists/shared/runtime.env', migration_env='/srv/apps/life2-lists/shared/migration.env', port=43240)
        networks=compose['services']['api']['networks']
        self.assertEqual(set(networks), {'postgresql','ingress'})
        self.assertEqual(networks, ['postgresql','ingress'])
        self.assertEqual(compose['services']['migrate']['networks'], ['postgresql'])

    def test_previous_0120_exact_seven_migration_baseline_is_retained(self):
        old={'schemaVersion':2,'component':'lists-service','version':'0.12.0','revision':'a'*40,'image':release_contract.IMAGE_PREFIX+'b'*64,'migrations':self.migrations()}
        release_contract.validate_manifest(old)
        self.assertEqual(host_candidate.expected_baseline_tables(old,self.migrations()),8)
