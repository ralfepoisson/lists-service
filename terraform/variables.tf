variable "aws_region" {
  description = "AWS region in which to deploy the service."
  type        = string
  default     = "eu-west-1"
}

variable "service_name" {
  description = "Stable service name used in AWS resource names."
  type        = string
  default     = "life2-lists-service"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.service_name))
    error_message = "service_name must contain only lowercase letters, digits, and hyphens."
  }
}

variable "environment" {
  description = "Environment discriminator, for example dev, staging, or prod."
  type        = string
  default     = "dev"

  validation {
    condition     = can(regex("^[a-z0-9-]+$", var.environment))
    error_message = "environment must contain only lowercase letters, digits, and hyphens."
  }
}

variable "todoist_token_secret_arn" {
  description = "ARN of an existing Secrets Manager secret containing only the Todoist token."
  type        = string
  sensitive   = true
}

variable "rest_api_token_secret_arn" {
  description = "ARN of an existing Secrets Manager secret containing only the REST bearer token."
  type        = string
  sensitive   = true
}

variable "life2_jwt_signing_key_secret_arn" {
  description = "ARN of an existing Secrets Manager secret containing the base64-encoded Life2 JWT signing key."
  type        = string
  sensitive   = true
}

variable "life2_allowed_account_id" {
  description = "The single Life2 account allowed to manage this shopping list."
  type        = string

  validation {
    condition     = trimspace(var.life2_allowed_account_id) != ""
    error_message = "life2_allowed_account_id must not be empty."
  }
}

variable "todoist_project_id" {
  description = "Preferred Todoist project ID. Set either this or todoist_project_name."
  type        = string
  default     = ""

  validation {
    condition     = trimspace(var.todoist_project_id) != "" || trimspace(var.todoist_project_name) != ""
    error_message = "Set either todoist_project_id or todoist_project_name."
  }
}

variable "todoist_project_name" {
  description = "Todoist project name to resolve once at cold start when no project ID is supplied."
  type        = string
  default     = ""
}

variable "alexa_skill_id" {
  description = "Alexa custom skill ID allowed to invoke the Alexa Lambda."
  type        = string

  validation {
    condition     = can(regex("^amzn1\\.ask\\.skill\\.[A-Za-z0-9-]+$", var.alexa_skill_id))
    error_message = "alexa_skill_id must be an Alexa custom skill identifier."
  }
}

variable "log_level" {
  description = "Minimum application JSON log level."
  type        = string
  default     = "info"

  validation {
    condition     = contains(["debug", "info", "warn", "error"], var.log_level)
    error_message = "log_level must be debug, info, warn, or error."
  }
}

variable "log_retention_days" {
  description = "CloudWatch log retention for Lambda and API access logs."
  type        = number
  default     = 30

  validation {
    condition     = contains([1, 3, 5, 7, 14, 30, 60, 90, 120, 150, 180, 365, 400, 545, 731, 1096, 1827, 2192, 2557, 2922, 3288, 3653], var.log_retention_days)
    error_message = "log_retention_days must be a retention value supported by CloudWatch Logs."
  }
}

variable "lambda_architecture" {
  description = "Lambda instruction-set architecture."
  type        = string
  default     = "arm64"

  validation {
    condition     = contains(["arm64", "x86_64"], var.lambda_architecture)
    error_message = "lambda_architecture must be arm64 or x86_64."
  }
}

variable "lambda_memory_mb" {
  description = "Memory allocated to each Lambda."
  type        = number
  default     = 256

  validation {
    condition     = var.lambda_memory_mb >= 128 && var.lambda_memory_mb <= 10240
    error_message = "lambda_memory_mb must be from 128 through 10240."
  }
}

variable "lambda_timeout_seconds" {
  description = "Timeout for each Lambda invocation."
  type        = number
  default     = 20

  validation {
    condition     = var.lambda_timeout_seconds >= 1 && var.lambda_timeout_seconds <= 900
    error_message = "lambda_timeout_seconds must be from 1 through 900."
  }
}

variable "completed_lookback_days" {
  description = "Number of days of completed Todoist items exposed by the service."
  type        = number
  default     = 90

  validation {
    condition     = var.completed_lookback_days >= 1 && var.completed_lookback_days <= 90
    error_message = "completed_lookback_days must be from 1 through 90."
  }
}

variable "todoist_api_base_url" {
  description = "Todoist API base URL, configurable for controlled testing."
  type        = string
  default     = "https://api.todoist.com/api/v1"
}

variable "alarm_actions" {
  description = "Optional SNS topic ARNs or other action ARNs notified by CloudWatch alarms."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Tags applied to supported AWS resources."
  type        = map(string)
  default = {
    ManagedBy = "Terraform"
    Service   = "life2-lists-service"
  }
}
