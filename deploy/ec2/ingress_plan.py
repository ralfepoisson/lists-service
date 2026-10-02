"""Fail-closed review of a saved Terraform DNS-only ingress handoff plan.

This tool reads `terraform show -json` output. It cannot apply a plan.
"""

import argparse
import json
from pathlib import Path


ADDRESSES = {
    "aws_route53_record.rest_ipv4[0]": "A",
    "aws_route53_record.rest_ipv6[0]": "AAAA",
}
HOST = "lists.life-sqrd.com"


def _alias(value, address):
    if not isinstance(value, dict):
        raise ValueError(f"{address}: missing record value")
    if value.get("name", "").rstrip(".").lower() != HOST:
        raise ValueError(f"{address}: unexpected record name")
    if value.get("type") != ADDRESSES[address]:
        raise ValueError(f"{address}: unexpected record type")
    aliases = value.get("alias")
    if not isinstance(aliases, list) or len(aliases) != 1:
        raise ValueError(f"{address}: expected one alias")
    alias = aliases[0]
    if not isinstance(alias, dict) or alias.get("evaluate_target_health") is not False:
        raise ValueError(f"{address}: unexpected alias settings")
    name, zone = alias.get("name"), alias.get("zone_id")
    if not isinstance(name, str) or not isinstance(zone, str):
        raise ValueError(f"{address}: missing alias identity")
    return name.rstrip(".").lower(), zone


def validate_plan(document, before, after):
    """Require exactly two in-place DNS alias updates to the captured targets."""
    if not isinstance(document, dict) or document.get("errored") is True:
        raise ValueError("Terraform plan is absent or errored")
    changes = document.get("resource_changes")
    if not isinstance(changes, list):
        raise ValueError("Terraform resource changes are absent")
    if any(drift.get("change", {}).get("actions") != ["no-op"]
           for drift in document.get("resource_drift", [])):
        raise ValueError("Terraform detected resource drift; recapture live state")
    if any(change.get("actions") != ["no-op"]
           for change in document.get("output_changes", {}).values()):
        raise ValueError("Terraform plan changes outputs beyond DNS records")
    actual = {}
    for resource in changes:
        if not isinstance(resource, dict) or not isinstance(resource.get("change"), dict):
            raise ValueError("malformed Terraform resource change")
        actions = resource["change"].get("actions")
        if actions == ["no-op"]:
            continue
        address = resource.get("address")
        if address not in ADDRESSES or address in actual:
            raise ValueError(f"unrelated or duplicate resource change: {address}")
        if resource.get("type") != "aws_route53_record" or actions != ["update"]:
            raise ValueError(f"{address}: only in-place DNS updates are allowed")
        change = resource["change"]
        if change.get("after_unknown"):
            raise ValueError(f"{address}: DNS target is not fully known")
        if _alias(change.get("before"), address) != before:
            raise ValueError(f"{address}: live alias differs from captured origin")
        if _alias(change.get("after"), address) != after:
            raise ValueError(f"{address}: planned alias differs from approved target")
        actual[address] = True
    if set(actual) != set(ADDRESSES):
        raise ValueError("both A and AAAA must change together")


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("plan_json", type=Path)
    parser.add_argument("before_name")
    parser.add_argument("before_zone")
    parser.add_argument("after_name")
    parser.add_argument("after_zone")
    args = parser.parse_args()
    document = json.loads(args.plan_json.read_text())
    validate_plan(
        document,
        (args.before_name.rstrip(".").lower(), args.before_zone),
        (args.after_name.rstrip(".").lower(), args.after_zone),
    )
    print("lists_ingress_plan=valid; only A and AAAA aliases update")


if __name__ == "__main__":
    main()
