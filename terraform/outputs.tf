output "rest_api_base_url" {
  description = "Canonical REST URL when a published version is activated."
  value       = local.rest_activation_enabled ? "https://${var.rest_domain_name}" : null
}

output "rest_candidate_version" {
  description = "New immutable REST Lambda version to invoke and accept before alias activation."
  value       = aws_lambda_function.rest.version
}

output "rest_active_version" {
  description = "REST Lambda version currently selected by the production alias."
  value       = local.rest_activation_enabled ? aws_lambda_alias.rest_active[0].function_version : null
}

output "rest_lambda_arn" {
  description = "ARN of the REST Lambda."
  value       = aws_lambda_function.rest.arn
}

output "alexa_lambda_arn" {
  description = "ARN to configure as the Alexa custom skill endpoint."
  value       = local.alexa_activation_enabled ? aws_lambda_alias.alexa_active[0].arn : null
}

output "alexa_candidate_version" {
  description = "New immutable Alexa Lambda version, or null until a real skill ID is configured."
  value       = local.alexa_enabled ? aws_lambda_function.alexa[0].version : null
}

output "alexa_active_version" {
  description = "Alexa Lambda version currently selected by the production alias."
  value       = local.alexa_activation_enabled ? aws_lambda_alias.alexa_active[0].function_version : null
}

output "alexa_skill_id" {
  description = "Alexa skill ID authorized by the Lambda resource policy."
  value       = var.alexa_skill_id
}

output "api_access_log_group" {
  description = "CloudWatch log group containing structured HTTP API access logs."
  value       = aws_cloudwatch_log_group.api_access.name
}
