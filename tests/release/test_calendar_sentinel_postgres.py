"""Real disposable PostgreSQL: exact fixture custody/cleanup, no mock behaviour."""
import importlib.util
import json
import os
import pathlib
import tempfile
import unittest
from urllib.parse import urlsplit,unquote

ROOT=pathlib.Path(__file__).resolve().parents[2]
SPEC=importlib.util.spec_from_file_location('calendar_owner_acceptance',ROOT/'deploy/ec2/calendar_owner_acceptance.py')
module=importlib.util.module_from_spec(SPEC);SPEC.loader.exec_module(module)


@unittest.skipUnless(os.environ.get('CALENDAR_LOOP_TEST_DSN'),'explicit disposable real PostgreSQL required')
class RealSentinelTest(unittest.TestCase):
    def setUp(self):
        u=urlsplit(os.environ['CALENDAR_LOOP_TEST_DSN'])
        if u.hostname!='127.0.0.1':raise ValueError('owned loopback fixture only')
        self.env={**os.environ,'PGHOST':u.hostname,'PGPORT':str(u.port),'PGDATABASE':u.path[1:],'PGUSER':unquote(u.username),'PGPASSWORD':unquote(u.password or ''),'PGCONNECT_TIMEOUT':'5'}
        self.psql=str(pathlib.Path(os.environ['POSTGRES_BIN_DIR'])/'psql')

    def sql(self,value):return module._sql(self.env,value,psql=self.psql)

    def test_exact_insert_owner_negative_and_complete_cleanup(self):
        before=self.sql("SELECT json_build_object('count',count(*)) FROM loops;")
        with tempfile.TemporaryDirectory() as directory:
            with module._fixture(self.env,directory,psql=self.psql) as (fixture,record):
                found=self.sql("SELECT json_build_object('own',count(*) FILTER(WHERE account_id='different-owning-test-account'),'sentinel',count(*) FILTER(WHERE account_id="+module.literal(fixture['namespace'])+")) FROM loops WHERE id="+module.literal(fixture['id'])+";")
                self.assertEqual(found,{'own':0,'sentinel':1})
                self.assertEqual(record['state'],'inserted')
            self.assertEqual(record['state'],'deleted-verified')
            ledger=json.loads(next(pathlib.Path(directory).glob('sentinel-*.json')).read_text())
            self.assertEqual(ledger['cleanup'],{'remaining':0})
        self.assertEqual(self.sql("SELECT json_build_object('count',count(*)) FROM loops;"),before)

    def test_changed_record_refuses_cleanup_and_retains_exact_intent(self):
        fixture=None
        try:
            with tempfile.TemporaryDirectory() as directory:
                with self.assertRaises(ValueError):
                    with module._fixture(self.env,directory,psql=self.psql) as (fixture,record):
                        self.sql("UPDATE loops SET outcome='changed synthetic fixture' WHERE id="+module.literal(fixture['id'])+";")
                self.assertEqual(self.sql("SELECT json_build_object('count',count(*)) FROM loops WHERE id="+module.literal(fixture['id'])+";"),{'count':1})
                self.assertEqual(record['state'],'inserted')
        finally:
            if fixture:
                self.sql("DELETE FROM loops WHERE id="+module.literal(fixture['id'])+" AND account_id="+module.literal(fixture['namespace'])+" AND outcome='changed synthetic fixture';")
