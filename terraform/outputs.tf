output "rest_api_base_url" {
  description = "Base URL for REST requests. All routes except /health require the bearer token."
  value       = aws_apigatewayv2_api.rest.api_endpoint
}

output "rest_lambda_arn" {
  description = "ARN of the REST Lambda."
  value       = aws_lambda_function.rest.arn
}

output "alexa_lambda_arn" {
  description = "ARN to configure as the Alexa custom skill endpoint."
  value       = aws_lambda_function.alexa.arn
}

output "alexa_skill_id" {
  description = "Alexa skill ID authorized by the Lambda resource policy."
  value       = var.alexa_skill_id
}

output "api_access_log_group" {
  description = "CloudWatch log group containing structured HTTP API access logs."
  value       = aws_cloudwatch_log_group.api_access.name
}
