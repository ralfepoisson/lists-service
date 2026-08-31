locals {
  resource_prefix          = "${var.service_name}-${var.environment}"
  rest_name                = "${local.resource_prefix}-rest"
  alexa_name               = "${local.resource_prefix}-alexa"
  rest_activation_enabled  = var.rest_active_version != ""
  alexa_enabled            = var.alexa_skill_id != ""
  alexa_activation_enabled = local.alexa_enabled && var.alexa_active_version != ""
  todoist_environment = {
    COMPLETED_LOOKBACK_DAYS = tostring(var.completed_lookback_days)
    LOG_LEVEL               = var.log_level
    TODOIST_API_BASE_URL    = var.todoist_api_base_url
  }
  rest_environment = merge(local.todoist_environment, {
    REST_API_TOKEN_SECRET_ARN         = var.rest_api_token_secret_arn
    LIFE2_JWT_SIGNING_KEY_SECRET_ARN  = var.life2_jwt_signing_key_secret_arn
    LIFE2_ALLOWED_ACCOUNT_ID          = var.life2_allowed_account_id
    TODOIST_TENANT_CATALOG_SECRET_ARN = var.todoist_tenant_catalog_secret_arn
    RELEASE_GIT_COMMIT                = var.release_git_commit
  })
  alexa_environment = merge(local.todoist_environment, {
    ALEXA_SKILL_ID                    = var.alexa_skill_id
    LIFE2_ALLOWED_ACCOUNT_ID          = var.life2_allowed_account_id
    TODOIST_TENANT_CATALOG_SECRET_ARN = var.todoist_tenant_catalog_secret_arn
    RELEASE_GIT_COMMIT                = var.release_git_commit
  })
}

data "archive_file" "rest" {
  type        = "zip"
  source_dir  = "${path.module}/../dist/rest-package"
  output_path = "${path.module}/rest-lambda.zip"
}

data "archive_file" "alexa" {
  count       = local.alexa_enabled ? 1 : 0
  type        = "zip"
  source_file = "${path.module}/../dist/alexa-lambda.mjs"
  output_path = "${path.module}/alexa-lambda.zip"
}

data "aws_iam_policy_document" "lambda_assume_role" {
  statement {
    effect  = "Allow"
    actions = ["sts:AssumeRole"]

    principals {
      type        = "Service"
      identifiers = ["lambda.amazonaws.com"]
    }
  }
}

resource "aws_iam_role" "rest" {
  name               = "${local.rest_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_iam_role" "alexa" {
  count              = local.alexa_enabled ? 1 : 0
  name               = "${local.alexa_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_cloudwatch_log_group" "rest" {
  name              = "/aws/lambda/${local.rest_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "alexa" {
  count             = local.alexa_enabled ? 1 : 0
  name              = "/aws/lambda/${local.alexa_name}"
  retention_in_days = var.log_retention_days
}

data "aws_iam_policy_document" "rest_runtime" {
  statement {
    sid       = "WriteOwnLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.rest.arn}:*"]
  }

  statement {
    sid     = "ReadRestRuntimeSecrets"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [
        var.todoist_tenant_catalog_secret_arn,
        var.rest_api_token_secret_arn,
        var.life2_jwt_signing_key_secret_arn
      ],
      var.todoist_tenant_token_secret_arns
    )
  }
}

data "aws_iam_policy_document" "alexa_runtime" {
  count = local.alexa_enabled ? 1 : 0
  statement {
    sid       = "WriteOwnLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.alexa[0].arn}:*"]
  }

  statement {
    sid     = "ReadTenantBoundTodoistConnection"
    effect  = "Allow"
    actions = ["secretsmanager:GetSecretValue"]
    resources = concat(
      [var.todoist_tenant_catalog_secret_arn],
      var.todoist_tenant_token_secret_arns
    )
  }
}

resource "aws_iam_role_policy" "rest_runtime" {
  name   = "${local.rest_name}-runtime"
  role   = aws_iam_role.rest.id
  policy = data.aws_iam_policy_document.rest_runtime.json
}

resource "aws_iam_role_policy" "alexa_runtime" {
  count  = local.alexa_enabled ? 1 : 0
  name   = "${local.alexa_name}-runtime"
  role   = aws_iam_role.alexa[0].id
  policy = data.aws_iam_policy_document.alexa_runtime[0].json
}

resource "aws_lambda_function" "rest" {
  function_name = local.rest_name
  description   = "Life2 Lists Service REST API"
  role          = aws_iam_role.rest.arn
  runtime       = "nodejs24.x"
  architectures = [var.lambda_architecture]
  handler       = "rest-lambda.handler"
  filename      = data.archive_file.rest.output_path
  publish       = true

  source_code_hash = data.archive_file.rest.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.rest_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.rest,
    aws_iam_role_policy.rest_runtime
  ]
}

resource "aws_lambda_function" "alexa" {
  count         = local.alexa_enabled ? 1 : 0
  function_name = local.alexa_name
  description   = "Life2 Lists Service Alexa custom skill"
  role          = aws_iam_role.alexa[0].arn
  runtime       = "nodejs24.x"
  architectures = [var.lambda_architecture]
  handler       = "alexa-lambda.handler"
  filename      = data.archive_file.alexa[0].output_path
  publish       = true

  source_code_hash = data.archive_file.alexa[0].output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.alexa_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.alexa[0],
    aws_iam_role_policy.alexa_runtime[0]
  ]
}

resource "aws_lambda_alias" "rest_active" {
  count            = local.rest_activation_enabled ? 1 : 0
  name             = "active"
  description      = "Accepted production REST release"
  function_name    = aws_lambda_function.rest.function_name
  function_version = var.rest_active_version
}

resource "aws_lambda_alias" "alexa_active" {
  count            = local.alexa_activation_enabled ? 1 : 0
  name             = "active"
  description      = "Accepted production Alexa release"
  function_name    = aws_lambda_function.alexa[0].function_name
  function_version = var.alexa_active_version
}

resource "aws_lambda_permission" "alexa_skill" {
  count              = local.alexa_activation_enabled ? 1 : 0
  statement_id       = "AllowAlexaSkillInvocation"
  action             = "lambda:InvokeFunction"
  function_name      = aws_lambda_function.alexa[0].function_name
  qualifier          = aws_lambda_alias.alexa_active[0].name
  principal          = "alexa-appkit.amazon.com"
  event_source_token = var.alexa_skill_id
}

resource "aws_apigatewayv2_api" "rest" {
  name                         = "${local.rest_name}-api"
  protocol_type                = "HTTP"
  description                  = "Authenticated HTTP API for the Life2 Lists Service"
  disable_execute_api_endpoint = true
}

resource "aws_apigatewayv2_integration" "rest" {
  count                  = local.rest_activation_enabled ? 1 : 0
  api_id                 = aws_apigatewayv2_api.rest.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_alias.rest_active[0].invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

locals {
  rest_routes = toset([
    "GET /health",
    "GET /health/ready",
    "GET /version",
    "GET /v1/items",
    "GET /v1/items.pdf",
    "POST /v1/items",
    "DELETE /v1/items",
    "DELETE /v1/items/{itemId}",
    "POST /v1/items/{itemId}/complete",
    "POST /v1/items/{itemId}/reopen",
    "GET /v1/todoist/connection",
    "POST /v1/todoist/connection/authorizations",
    "DELETE /v1/todoist/connection",
    "GET /v1/task-lists",
    "POST /v1/task-lists",
    "DELETE /v1/task-lists/{listId}",
    "GET /v1/task-lists/{listId}/tasks",
    "POST /v1/task-lists/{listId}/tasks",
    "PUT /v1/task-lists/{listId}/tasks/order",
    "PATCH /v1/task-lists/{listId}/tasks/{taskId}",
    "DELETE /v1/task-lists/{listId}/tasks/{taskId}",
    "POST /v1/task-lists/{listId}/tasks/{taskId}/complete"
  ])
}

resource "aws_apigatewayv2_route" "rest" {
  for_each = local.rest_activation_enabled ? local.rest_routes : toset([])

  api_id    = aws_apigatewayv2_api.rest.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.rest[0].id}"
}

resource "aws_cloudwatch_log_group" "api_access" {
  name              = "/aws/apigateway/${local.rest_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_apigatewayv2_stage" "default" {
  api_id      = aws_apigatewayv2_api.rest.id
  name        = "$default"
  auto_deploy = true

  access_log_settings {
    destination_arn = aws_cloudwatch_log_group.api_access.arn
    format = jsonencode({
      requestId        = "$context.requestId"
      requestTime      = "$context.requestTime"
      routeKey         = "$context.routeKey"
      status           = "$context.status"
      responseLength   = "$context.responseLength"
      integrationError = "$context.integrationErrorMessage"
      sourceIp         = "$context.identity.sourceIp"
    })
  }

  default_route_settings {
    detailed_metrics_enabled = true
    throttling_burst_limit   = 50
    throttling_rate_limit    = 25
  }
}

resource "aws_lambda_permission" "api_gateway" {
  count         = local.rest_activation_enabled ? 1 : 0
  statement_id  = "AllowApiGatewayInvocation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rest.function_name
  qualifier     = aws_lambda_alias.rest_active[0].name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rest.execution_arn}/*/*"
}

resource "aws_apigatewayv2_domain_name" "rest" {
  count       = local.rest_activation_enabled ? 1 : 0
  domain_name = var.rest_domain_name

  domain_name_configuration {
    certificate_arn = var.rest_certificate_arn
    endpoint_type   = "REGIONAL"
    security_policy = "TLS_1_2"
  }
}

resource "aws_apigatewayv2_api_mapping" "rest" {
  count       = local.rest_activation_enabled ? 1 : 0
  api_id      = aws_apigatewayv2_api.rest.id
  domain_name = aws_apigatewayv2_domain_name.rest[0].id
  stage       = aws_apigatewayv2_stage.default.id
}

resource "aws_route53_record" "rest_ipv4" {
  count   = local.rest_activation_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.rest_domain_name
  type    = "A"

  alias {
    name                   = aws_apigatewayv2_domain_name.rest[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.rest[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}

resource "aws_route53_record" "rest_ipv6" {
  count   = local.rest_activation_enabled ? 1 : 0
  zone_id = var.route53_zone_id
  name    = var.rest_domain_name
  type    = "AAAA"

  alias {
    name                   = aws_apigatewayv2_domain_name.rest[0].domain_name_configuration[0].target_domain_name
    zone_id                = aws_apigatewayv2_domain_name.rest[0].domain_name_configuration[0].hosted_zone_id
    evaluate_target_health = false
  }
}
