locals {
  resource_prefix = "${var.service_name}-${var.environment}"
  rest_name       = "${local.resource_prefix}-rest"
  alexa_name      = "${local.resource_prefix}-alexa"
  common_environment = {
    ALEXA_SKILL_ID           = var.alexa_skill_id
    COMPLETED_LOOKBACK_DAYS  = tostring(var.completed_lookback_days)
    LOG_LEVEL                = var.log_level
    TODOIST_API_BASE_URL     = var.todoist_api_base_url
    TODOIST_PROJECT_ID       = var.todoist_project_id
    TODOIST_PROJECT_NAME     = var.todoist_project_name
    TODOIST_TOKEN_SECRET_ARN = var.todoist_token_secret_arn
    # AppConfig validates this identifier for both composition roots. Only the
    # REST role below is permitted to read the referenced secret.
    REST_API_TOKEN_SECRET_ARN        = var.rest_api_token_secret_arn
    LIFE2_JWT_SIGNING_KEY_SECRET_ARN = var.life2_jwt_signing_key_secret_arn
    LIFE2_ALLOWED_ACCOUNT_ID         = var.life2_allowed_account_id
  }
}

data "archive_file" "rest" {
  type        = "zip"
  source_file = "${path.module}/../dist/rest-lambda.mjs"
  output_path = "${path.module}/rest-lambda.zip"
}

data "archive_file" "alexa" {
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
  name               = "${local.alexa_name}-role"
  assume_role_policy = data.aws_iam_policy_document.lambda_assume_role.json
}

resource "aws_cloudwatch_log_group" "rest" {
  name              = "/aws/lambda/${local.rest_name}"
  retention_in_days = var.log_retention_days
}

resource "aws_cloudwatch_log_group" "alexa" {
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
    resources = [
      var.todoist_token_secret_arn,
      var.rest_api_token_secret_arn,
      var.life2_jwt_signing_key_secret_arn
    ]
  }
}

data "aws_iam_policy_document" "alexa_runtime" {
  statement {
    sid       = "WriteOwnLogs"
    effect    = "Allow"
    actions   = ["logs:CreateLogStream", "logs:PutLogEvents"]
    resources = ["${aws_cloudwatch_log_group.alexa.arn}:*"]
  }

  statement {
    sid       = "ReadTodoistTokenOnly"
    effect    = "Allow"
    actions   = ["secretsmanager:GetSecretValue"]
    resources = [var.todoist_token_secret_arn]
  }
}

resource "aws_iam_role_policy" "rest_runtime" {
  name   = "${local.rest_name}-runtime"
  role   = aws_iam_role.rest.id
  policy = data.aws_iam_policy_document.rest_runtime.json
}

resource "aws_iam_role_policy" "alexa_runtime" {
  name   = "${local.alexa_name}-runtime"
  role   = aws_iam_role.alexa.id
  policy = data.aws_iam_policy_document.alexa_runtime.json
}

resource "aws_lambda_function" "rest" {
  function_name = local.rest_name
  description   = "Life2 Lists Service REST API"
  role          = aws_iam_role.rest.arn
  runtime       = "nodejs24.x"
  architectures = [var.lambda_architecture]
  handler       = "rest-lambda.handler"
  filename      = data.archive_file.rest.output_path

  source_code_hash = data.archive_file.rest.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.common_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.rest,
    aws_iam_role_policy.rest_runtime
  ]
}

resource "aws_lambda_function" "alexa" {
  function_name = local.alexa_name
  description   = "Life2 Lists Service Alexa custom skill"
  role          = aws_iam_role.alexa.arn
  runtime       = "nodejs24.x"
  architectures = [var.lambda_architecture]
  handler       = "alexa-lambda.handler"
  filename      = data.archive_file.alexa.output_path

  source_code_hash = data.archive_file.alexa.output_base64sha256
  memory_size      = var.lambda_memory_mb
  timeout          = var.lambda_timeout_seconds

  environment {
    variables = local.common_environment
  }

  depends_on = [
    aws_cloudwatch_log_group.alexa,
    aws_iam_role_policy.alexa_runtime
  ]
}

resource "aws_lambda_permission" "alexa_skill" {
  statement_id       = "AllowAlexaSkillInvocation"
  action             = "lambda:InvokeFunction"
  function_name      = aws_lambda_function.alexa.function_name
  principal          = "alexa-appkit.amazon.com"
  event_source_token = var.alexa_skill_id
}

resource "aws_apigatewayv2_api" "rest" {
  name          = "${local.rest_name}-api"
  protocol_type = "HTTP"
  description   = "Authenticated HTTP API for the Life2 Lists Service"
}

resource "aws_apigatewayv2_integration" "rest" {
  api_id                 = aws_apigatewayv2_api.rest.id
  integration_type       = "AWS_PROXY"
  integration_uri        = aws_lambda_function.rest.invoke_arn
  integration_method     = "POST"
  payload_format_version = "2.0"
  timeout_milliseconds   = 30000
}

locals {
  rest_routes = toset([
    "GET /health",
    "GET /health/ready",
    "GET /v1/items",
    "POST /v1/items",
    "DELETE /v1/items",
    "DELETE /v1/items/{itemId}",
    "POST /v1/items/{itemId}/complete",
    "POST /v1/items/{itemId}/reopen"
  ])
}

resource "aws_apigatewayv2_route" "rest" {
  for_each = local.rest_routes

  api_id    = aws_apigatewayv2_api.rest.id
  route_key = each.value
  target    = "integrations/${aws_apigatewayv2_integration.rest.id}"
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
  statement_id  = "AllowApiGatewayInvocation"
  action        = "lambda:InvokeFunction"
  function_name = aws_lambda_function.rest.function_name
  principal     = "apigateway.amazonaws.com"
  source_arn    = "${aws_apigatewayv2_api.rest.execution_arn}/*/*"
}
