# Lists production ingress handoff (source contract)

This contract prepares a later guarded switch from the accepted 0.8.0 REST
Lambda to the accepted 0.9.0 EC2 candidate. It does not execute the switch.
The Lists Terraform state remains the owner of the `lists.life-sqrd.com` A and
AAAA aliases, API Gateway custom domain and mapping, and Lambda `active` alias.
The `rest_ingress_target` variable is mandatory: `api_gateway` retains the
current route; `alb` selects a separately reviewed ALB DNS name and canonical
hosted-zone ID. A change of selector updates only DNS alias targets. Keep the
protected production config selector aligned with actual DNS after each switch
so later Terraform plans cannot quietly reverse the choice.

## Current read-only checkpoint, 2026-10-03

- API Gateway regional alias: `d-rnbmgpffed.execute-api.eu-west-1.amazonaws.com`,
  zone `ZLY8HYME6SFDD`; API `vi0ihmv3d0`, default-stage mapping `jotldp`.
- Consolidated ALB: `personal-projects-consolidated-1929936575.eu-west-1.elb.amazonaws.com`,
  zone `Z32O12XQLNTSW2`; the wildcard `*.life-sqrd.com` certificate and WAF
  are attached. The ALB is currently `ipv4`. Existing `app.life-sqrd.com` A
  and AAAA aliases both target this ALB, but its AAAA lookup returns no IPv6
  address. The current Lists API Gateway AAAA alias also returns no IPv6
  address. Preserve and move both managed record sets together; an AAAA alias
  record is not proof of IPv6 service.
- No Lists ALB host rule or Apache vhost has been selected. Inspect listener
  priorities at execution time; a free priority observed now is not a
  reservation. The Lists 0.8.0 Lambda `active` alias version 7 remains public.
- The dedicated Lists database and roles exist, but the database is empty and
  migration/candidate acceptance are pending fresh real tenant JWTs. The
  candidate gate and public switch must not be inferred from this document.

## Stage without selecting DNS

1. Capture exact A/AAAA record JSON, Terraform state addresses, Lambda alias
   version, API Gateway domain/mapping, ALB listener/rules and free priority,
   ALB target-group health, WAF/certificate association, Apache vhosts,
   candidate manifest and image digest, database backup/migration evidence,
   and authenticated public responses in a private change record. Recheck all
   identities at execution time. Do not change the Lambda alias or remove the
   API Gateway domain/mapping.
2. Complete the maintained EC2 candidate gate with two distinct real Auth
   tenant tokens, including scratch restore, migration, exact image/revision,
   persisted Loop lifecycle and cross-tenant denial. Identify its actual
   loopback port, 43240 or 43241. The root-controlled Apache template at
   `deploy/ec2/apache/life2-lists.conf.template` must be rendered with that
   single verified port. Check Apache syntax and the loopback vhost before
   enabling it. An ALB host rule for exactly `lists.life-sqrd.com` must use a
   freshly checked unused priority and the reviewed healthy Apache `:8080`
   target group. Stage the rule while DNS still serves API Gateway. Check WAF,
   certificate, listener and ALB health again. Do not borrow another hostname's
   rule priority or alter its target group.
3. Verify the new path with controlled DNS/Host routing before any public DNS
   change: exact `/version` image revision, `/health`, authenticated readiness,
   Shopping and Task Lists reads, persisted Loop read/write/close and tenant
   isolation, plus bad-token rejection. A Host header against Apache alone
   proves only Apache routing; also prove the full ALB TLS/WAF route without
   replacing public DNS.

## Exact DNS-only plan

Update the existing owner-only production config privately with
`REST_INGRESS_TARGET=alb`, `REST_ALB_DNS_NAME`, and `REST_ALB_ZONE_ID` from a
fresh `describe-load-balancers` read. Keep `REST_ACTIVE_VERSION` equal to the
observed published Lambda alias version. Never place secrets or JWTs in this
config or in Git. The ordinary `scripts/deploy-production.sh` rebuilds and
publishes Lambda, so it is not the ingress-switch command.

`scripts/plan-ingress-handoff.sh` initializes the existing S3 backend and
creates a saved, DNS-targeted Terraform plan in an owner-only directory. It
does not apply. Supply the captured before and after DNS identities; the tool
rechecks the live Lambda alias and, on ALB handoff, public 0.8.0 `/version`. It
rejects a missing active alias, a different AWS account, a mismatched ALB
target, existing plan files and any plan beyond the two in-place A/AAAA alias
updates. Its validator rejects Lambda updates, API Gateway deletions,
unknown target values, unrelated output changes, drift and one-record changes.
Generate the saved plan fresh immediately before cutover, then inspect it and
apply promptly. Example using the checkpoint
above, which must be re-read before use:

```sh
./scripts/plan-ingress-handoff.sh \
  /absolute/private/lists-production.env \
  /absolute/private/lists-ec2-handoff.tfplan \
  d-rnbmgpffed.execute-api.eu-west-1.amazonaws.com ZLY8HYME6SFDD \
  personal-projects-consolidated-1929936575.eu-west-1.elb.amazonaws.com Z32O12XQLNTSW2
```

Review the text plan and saved JSON independently, then immediately re-read
the live A and AAAA records and check they still match the captured before
target. Only after all authenticated candidate/ALB gates pass, apply that exact
saved plan with the same Terraform backend and verify both DNS aliases,
canonical TLS, image/revision, authenticated Shopping/Task Lists and persisted
Loops. Verify the Lambda alias and API Gateway mapping remain at their captured
values. A public health response or anonymous 401 is insufficient.

```sh
terraform -chdir=terraform show /absolute/private/lists-ec2-handoff.tfplan
terraform -chdir=terraform apply /absolute/private/lists-ec2-handoff.tfplan
```

## Exact rollback

Keep the accepted Lambda version, API Gateway domain/mapping, ALB rule, Apache
vhost, candidate, backup and additive database migration until the public
path is accepted. For ingress failure, set the protected config selector back
to `api_gateway`, retain the captured ALB identity, and create a new saved
DNS-only plan with **current** ALB A/AAAA identities as before and the
**captured exact** API Gateway alias name/zone as after. Validate it with the
same tool; apply the reviewed plan and prove the old canonical TLS, Lambda
revision, authenticated Todoist reads and negative authorization. Disable the
new ALB host rule/vhost only after the public API Gateway path has recovered.
Do not drop Lists data, undo the additive migration, delete the verified
archive, delete the API Gateway mapping, or retarget Lambda as a DNS rollback.

## Existing EC2 service upgrades

The 0.10.1 release retains the already accepted EC2/DNS/ALB ingress architecture.
Its guarded host activation changes only the two existing Apache loopback ports,
after restored migration rehearsal and authenticated candidate acceptance. The
exact prior site and 0.9 image remain the rollback authority. See
[the current release runbook](ec2-candidate-runbook.md); do not rerun the original
Terraform DNS handoff for this upgrade.
