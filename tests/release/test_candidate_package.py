import importlib.util
import pathlib
import subprocess
import sys
import unittest
from unittest.mock import patch


ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "deploy" / "ec2"))
SPEC = importlib.util.spec_from_file_location(
    "host_candidate", ROOT / "deploy" / "ec2" / "host_candidate.py"
)
host_candidate = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(host_candidate)


class CandidatePackageTest(unittest.TestCase):
    def test_host_installer_syntax_gate_accepts_shell_launcher(self):
        check = subprocess.run(
            ["bash", str(ROOT / "deploy" / "ec2" / "install-host-tools.sh"), "--check-source"],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(check.returncode, 0, check.stderr)
        self.assertIn("host_tool_source=valid", check.stdout)

    def test_secret_access_preflight_checks_all_runtime_arns_without_returning_values(self):
        arns = {
            "REST_API_TOKEN_SECRET_ARN": "arn:aws:secretsmanager:eu-west-1:154596858576:secret:rest",
            "LIFE2_JWT_SIGNING_KEY_SECRET_ARN": "arn:aws:secretsmanager:eu-west-1:154596858576:secret:jwt",
            "TODOIST_TENANT_CATALOG_SECRET_ARN": "arn:aws:secretsmanager:eu-west-1:154596858576:secret:catalog",
        }
        with patch.object(host_candidate, "_run", side_effect=[
            arn.encode() + b"\n" for arn in arns.values()
        ]) as run:
            host_candidate._verify_secret_access(arns)
        self.assertEqual(run.call_count, 3)
        for call in run.call_args_list:
            self.assertIn("--query", call.args[0])
            self.assertIn("ARN", call.args[0])

    def test_compose_exposes_only_loopback_and_separates_migration_secrets(self):
        image = (
            "154596858576.dkr.ecr.eu-west-1.amazonaws.com/"
            "life2-lists@sha256:" + "a" * 64
        )
        compose = host_candidate.render_compose(
            image=image,
            runtime_env="/srv/apps/life2-lists/shared/runtime.env",
            migration_env="/srv/apps/life2-lists/shared/migration.env",
            port=43240,
        )
        services = compose["services"]
        self.assertEqual(services["api"]["image"], image)
        self.assertEqual(services["api"]["ports"], ["127.0.0.1:43240:3000"])
        self.assertEqual(
            services["api"]["env_file"], ["/srv/apps/life2-lists/shared/runtime.env"]
        )
        self.assertEqual(
            services["migrate"]["env_file"], ["/srv/apps/life2-lists/shared/migration.env"]
        )
        self.assertNotIn("ports", services["migrate"])
        self.assertEqual(services["migrate"]["networks"], ["postgresql"])
        self.assertEqual(
            compose["networks"]["postgresql"],
            {"external": True, "name": "personal-projects-postgresql"},
        )

    def test_candidate_port_and_image_are_bounded(self):
        for port in (80, 3000, 43239, 43242, 65535):
            with self.subTest(port=port), self.assertRaises(ValueError):
                host_candidate.render_compose(
                    image="invalid", runtime_env="/tmp/runtime", migration_env="/tmp/migrate",
                    port=port,
                )


if __name__ == "__main__":
    unittest.main()


class UpgradeIngressTest(unittest.TestCase):
    def test_upgrade_changes_only_the_two_accepted_loopback_targets(self):
        previous = b'ServerName lists.life-sqrd.com\nProxyPass / http://127.0.0.1:43240/\nProxyPassReverse / http://127.0.0.1:43240/\n'
        expected = previous.replace(b':43240/', b':43241/')
        self.assertEqual(host_candidate.render_ingress_upgrade(previous, 43241), expected)
        for invalid in (
            previous.replace(b'lists.life-sqrd.com', b'other.life-sqrd.com'),
            previous.replace(b':43240/', b':8000/'),
            previous.replace(b'ProxyPassReverse', b'other').replace(b'http://127.0.0.1:43240/', b'http://127.0.0.1:43241/', 1),
        ):
            with self.assertRaises(ValueError):
                host_candidate.render_ingress_upgrade(invalid, 43241)


class UpgradeNetworkTest(unittest.TestCase):
    def test_upgrade_reuses_only_a_component_owned_ingress_bridge(self):
        kwargs = dict(image=host_candidate.IMAGE_PREFIX + "a" * 64, runtime_env="/srv/apps/life2-lists/shared/runtime.env", migration_env="/srv/apps/life2-lists/shared/migration.env", port=43241)
        name = "life2-lists-ca19aa246b9b_ingress"
        compose = host_candidate.render_compose(**kwargs, ingress_network=name)
        self.assertEqual(compose["networks"]["ingress"], {"external": True, "name": name})
        for invalid in ("other_ingress", "personal-projects-postgresql", "life2-lists-x_ingress"):
            with self.assertRaises(ValueError):
                host_candidate.render_compose(**kwargs, ingress_network=invalid)
