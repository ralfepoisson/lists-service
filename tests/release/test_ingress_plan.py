import importlib.util
import pathlib
import subprocess
import tempfile
import unittest


ROOT = pathlib.Path(__file__).resolve().parents[2]
SPEC = importlib.util.spec_from_file_location(
    "ingress_plan", ROOT / "deploy" / "ec2" / "ingress_plan.py"
)
ingress_plan = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(ingress_plan)

API_NAME = "d-rnbmgpffed.execute-api.eu-west-1.amazonaws.com"
API_ZONE = "ZLY8HYME6SFDD"
ALB_NAME = "personal-projects-consolidated-1929936575.eu-west-1.elb.amazonaws.com"
ALB_ZONE = "Z32O12XQLNTSW2"


def record(address, before, after, action=("update",)):
    def value(target):
        return {"name": "lists.life-sqrd.com", "type": "A" if address == "ipv4" else "AAAA",
                "alias": [{"name": target[0], "zone_id": target[1],
                           "evaluate_target_health": False}]}

    return {"address": "aws_route53_record.rest_" + address + "[0]",
            "type": "aws_route53_record",
            "change": {"actions": list(action), "before": value(before), "after": value(after)}}


def plan(before=(API_NAME, API_ZONE), after=(ALB_NAME, ALB_ZONE)):
    return {"resource_changes": [record("ipv4", before, after),
                                 record("ipv6", before, after)]}


class IngressPlanTest(unittest.TestCase):
    def test_protected_production_config_requires_explicit_selector(self):
        base = (
            "AWS_REGION=eu-west-1\nTF_STATE_BUCKET=bucket\nTF_STATE_KEY=key\n"
            "ROUTE53_ZONE_ID=ZONE\nREST_CERTIFICATE_ARN=arn\n"
            "REST_DOMAIN_NAME=lists.life-sqrd.com\n"
            "TODOIST_TENANT_CATALOG_SECRET_ARN=arn\n"
            "TODOIST_TENANT_TOKEN_SECRET_ARNS=arn\n"
            "REST_API_TOKEN_SECRET_ARN=arn\nLIFE2_JWT_SIGNING_KEY_SECRET_ARN=arn\n"
            "LIFE2_ALLOWED_ACCOUNT_ID=account\nREST_ACTIVE_VERSION=7\n"
        )
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory) / "production.env"
            for addition, expected_ok in (
                ("", False),
                ("REST_INGRESS_TARGET=api_gateway\n", True),
                ("REST_INGRESS_TARGET=alb\n", False),
                ("REST_INGRESS_TARGET=alb\nREST_ALB_DNS_NAME=alb.example.com\n"
                 "REST_ALB_ZONE_ID=ZONE\n", True),
            ):
                with self.subTest(addition=addition):
                    path.write_text(base + addition)
                    path.chmod(0o600)
                    run = subprocess.run(
                        ["sh", str(ROOT / "scripts" / "validate-production-config.sh"),
                         str(path)], capture_output=True, text=True, check=False,
                    )
                    self.assertEqual(run.returncode == 0, expected_ok, run.stderr)

    def test_exact_paired_dns_handoff_and_rollback(self):
        ingress_plan.validate_plan(plan(), (API_NAME, API_ZONE), (ALB_NAME, ALB_ZONE))
        ingress_plan.validate_plan(
            plan((ALB_NAME, ALB_ZONE), (API_NAME, API_ZONE)),
            (ALB_NAME, ALB_ZONE), (API_NAME, API_ZONE),
        )

    def test_rejects_unrelated_or_destructive_change(self):
        cases = [
            plan() | {"resource_changes": plan()["resource_changes"] + [
                {"address": "aws_lambda_function.rest", "type": "aws_lambda_function",
                 "change": {"actions": ["update"]}}]},
            {"resource_changes": [record("ipv4", (API_NAME, API_ZONE),
                                         (ALB_NAME, ALB_ZONE))]},
            {"resource_changes": [record("ipv4", (API_NAME, API_ZONE),
                                         (ALB_NAME, ALB_ZONE), ("delete",)),
                                  record("ipv6", (API_NAME, API_ZONE),
                                         (ALB_NAME, ALB_ZONE))]},
            plan(after=("unexpected.example.com", ALB_ZONE)),
            plan(before=("unexpected.example.com", API_ZONE)),
            plan() | {"resource_drift": [{"address": "aws_route53_record.rest_ipv4[0]",
                                         "change": {"actions": ["update"]}}]},
            plan() | {"output_changes": {"rest_active_version":
                                          {"actions": ["update"]}}},
        ]
        for candidate in cases:
            with self.subTest(candidate=candidate), self.assertRaises(ValueError):
                ingress_plan.validate_plan(candidate, (API_NAME, API_ZONE),
                                           (ALB_NAME, ALB_ZONE))


if __name__ == "__main__":
    unittest.main()
