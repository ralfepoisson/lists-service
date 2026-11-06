"""UNIT: explicitly limited profile, never a fallback for missing tenant tokens."""
import importlib.util
import pathlib
import unittest

ROOT=pathlib.Path(__file__).resolve().parents[2]
spec=importlib.util.spec_from_file_location('calendar_owner_acceptance',ROOT/'deploy/ec2/calendar_owner_acceptance.py')
module=importlib.util.module_from_spec(spec)


class ContractTest(unittest.TestCase):
    def contract(self):
        return {'schemaVersion':'calendar-owner-sentinel/v1','authorityRef':'Todoist:6hwGJ9CxJHj6Fg3R:6hwRG3hM6hqCHMQR','accountId':'own-account','subject':'own-subject','expiresAt':2000}

    def test_exact_original_authority_and_own_principal_required(self):
        spec.loader.exec_module(module)
        value=self.contract()
        self.assertEqual(module.validate_contract(value,{'accountId':'own-account','sub':'own-subject'},now=1000),value)
        for key,new in [('schemaVersion','two-token-equivalent'),('authorityRef','invented-approval'),('expiresAt',900),('accountId','another'),('subject','another')]:
            bad={**value,key:new}
            with self.assertRaises(ValueError):module.validate_contract(bad,{'accountId':'own-account','sub':'own-subject'},now=1000)

    def test_sentinel_never_names_an_auth_principal_or_customer_row(self):
        spec.loader.exec_module(module)
        value=module.new_sentinel()
        self.assertTrue(value['namespace'].startswith('calendar-release-sentinel:'))
        self.assertEqual(value['subject'],'disposable-fixture-not-an-auth-principal')
        self.assertEqual(value['status'],'closed')
        self.assertIn('DISPOSABLE',value['title'])
        self.assertNotEqual(value['id'],module.new_sentinel()['id'])


class ExplicitModeTest(unittest.TestCase):
    def test_missing_foreign_token_never_falls_back(self):
        import sys
        sys.path.insert(0,str(ROOT/'deploy/ec2'))
        import candidate_smoke
        from unittest.mock import patch
        with patch.object(candidate_smoke,'load_token',side_effect=['primary',FileNotFoundError()]),patch.object(candidate_smoke,'_request') as request:
            with self.assertRaises(FileNotFoundError):
                candidate_smoke.run_smoke('http://127.0.0.1:43240','primary','foreign',expected_revision='a'*40)
        request.assert_not_called()

    def test_exact_four_negative_checks_use_only_own_real_token(self):
        import sys
        sys.path.insert(0,str(ROOT/'deploy/ec2'))
        import candidate_smoke
        from unittest.mock import patch
        spec.loader.exec_module(module)
        ident='a'*8+'-'+'b'*4+'-'+'c'*4+'-'+'d'*4+'-'+'e'*12
        with patch.object(candidate_smoke,'_request',return_value=(404,None)) as request:
            module.negative_http('https://lists.life-sqrd.com','own-normal-token',ident)
        self.assertEqual(request.call_count,4)
        self.assertEqual([c.kwargs.get('method','GET') for c in request.call_args_list],['GET','PATCH','GET','POST'])
        self.assertTrue(all(c.kwargs['token']=='own-normal-token' and ident in c.args[1] for c in request.call_args_list))
