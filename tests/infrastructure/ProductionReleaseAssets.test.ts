import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (path: string): string => readFileSync(path, 'utf8');

describe('production release assets', () => {
  it('uses a remote lockable backend and publishes immutable Lambda candidates', () => {
    const versions = read('terraform/versions.tf');
    const main = read('terraform/main.tf');
    const outputs = read('terraform/outputs.tf');

    expect(versions).toContain('backend "s3"');
    expect(main).toMatch(/resource "aws_lambda_function" "rest"[\s\S]*publish\s*=\s*true/);
    expect(main).toContain('resource "aws_lambda_alias" "rest_active"');
    expect(main).toContain('var.rest_active_version');
    expect(outputs).toContain('aws_lambda_function.rest.version');
    expect(main).toContain('RELEASE_GIT_COMMIT');
  });

  it('provides Node createRequire to bundled CommonJS dependencies in ESM Lambdas', () => {
    const build = read('scripts/build.mjs');

    expect(build).toContain('createRequire(import.meta.url)');
    expect(build).toContain('banner:');
  });

  it('packages PDFKit runtime data with local and REST Lambda bundles', () => {
    const build = read('scripts/build.mjs');
    const dockerfile = read('Dockerfile');
    const deploy = read('scripts/deploy-production.sh');
    const main = read('terraform/main.tf');
    const packageJson = read('package.json');

    expect(build).toContain('node_modules/pdfkit/js/data');
    expect(build).toContain('fileURLToPath(import.meta.url)');
    expect(build).toContain('dist/data');
    expect(build).toContain('dist/rest-package');
    expect(dockerfile).toContain('/app/dist/data ./data');
    expect(deploy).toContain('/app/dist/rest-package');
    expect(main).toMatch(/source_dir\s*=\s*"\$\{path\.module\}\/\.\.\/dist\/rest-package"/);
    expect(packageJson).toContain('npm run build && npm run verify:build');
  });

  it('activates the canonical HTTPS origin only through the REST alias', () => {
    const main = read('terraform/main.tf');

    expect(main).toContain('resource "aws_apigatewayv2_domain_name" "rest"');
    expect(main).toContain('resource "aws_apigatewayv2_api_mapping" "rest"');
    expect(main).toContain('resource "aws_route53_record" "rest_ipv4"');
    expect(main).toContain('resource "aws_route53_record" "rest_ipv6"');
    expect(main).toContain('aws_lambda_alias.rest_active');
    expect(main).toContain('var.rest_domain_name');
    expect(main).toContain('"GET /v1/items.pdf"');
  });

  it('keeps Alexa absent until a real skill id exists and supports versioned activation', () => {
    const main = read('terraform/main.tf');
    const variables = read('terraform/variables.tf');

    expect(variables).toContain('variable "alexa_skill_id"');
    expect(variables).toContain('default     = ""');
    expect(variables).toContain('variable "alexa_active_version"');
    expect(main).toContain('local.alexa_enabled');
    expect(main).toContain('resource "aws_lambda_alias" "alexa_active"');
    expect(main).toContain('var.alexa_active_version');
  });

  it('provides secret-safe state bootstrap, candidate, activation, and rollback commands', () => {
    const bootstrap = read('scripts/bootstrap-production-state.sh');
    const deploy = read('scripts/deploy-production.sh');
    const accept = read('scripts/accept-rest-candidate.sh');
    const secrets = read('scripts/sync-production-secret.sh');

    expect(bootstrap).toContain('put-public-access-block');
    expect(bootstrap).toContain('put-bucket-versioning');
    expect(deploy).toContain('--candidate');
    expect(deploy).toContain('--activate-rest');
    expect(deploy).toContain('--rollback-rest');
    expect(deploy).toContain('use_lockfile=true');
    expect(accept).toContain('invalid bearer rejection');
    expect(accept).toContain('/health/ready');
    expect(accept).toContain('/v1/items');
    expect(secrets).toContain('file://');
    expect(secrets).not.toContain('cat ');
  });
});
