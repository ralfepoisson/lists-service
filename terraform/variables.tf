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

variable "todoist_tenant_catalog_secret_arn" {
  description = "ARN of the server-side accountId to Todoist token-secret reference catalogue."
  type        = string
  sensitive   = true
}

variable "todoist_tenant_token_secret_arns" {
  description = "Exact Todoist token secret ARNs referenced by the tenant catalogue."
  type        = list(string)
  sensitive   = true

  validation {
    condition     = length(var.todoist_tenant_token_secret_arns) > 0 && alltrue([for arn in var.todoist_tenant_token_secret_arns : trimspace(arn) != ""])
    error_message = "todoist_tenant_token_secret_arns must contain at least one non-empty secret ARN."
  }
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
  description = "Alexa custom skill ID allowed to invoke the Alexa Lambda. Leave blank until the real skill exists."
  type        = string
  default     = ""

  validation {
    condition     = var.alexa_skill_id == "" || can(regex("^amzn1\\.ask\\.skill\\.[A-Za-z0-9-]+$", var.alexa_skill_id))
    error_message = "alexa_skill_id must be blank or an Alexa custom skill identifier."
  }
}

variable "rest_active_version" {
  description = "Published REST Lambda version served by the production alias. Blank publishes a candidate without activation."
  type        = string
  default     = ""

  validation {
    condition     = var.rest_active_version == "" || can(regex("^[1-9][0-9]*$", var.rest_active_version))
    error_message = "rest_active_version must be blank or a positive published Lambda version."
  }
}

variable "alexa_active_version" {
  description = "Published Alexa Lambda version served by the Alexa alias. Blank keeps Alexa unactivated."
  type        = string
  default     = ""

  validation {
    condition     = var.alexa_active_version == "" || can(regex("^[1-9][0-9]*$", var.alexa_active_version))
    error_message = "alexa_active_version must be blank or a positive published Lambda version."
  }
}

variable "release_git_commit" {
  description = "Exact clean main commit bundled into this immutable Lambda release."
  type        = string

  validation {
    condition     = can(regex("^[0-9a-f]{40}$", var.release_git_commit))
    error_message = "release_git_commit must be a full lowercase Git commit hash."
  }
}

variable "rest_domain_name" {
  description = "Canonical production hostname for the REST API."
  type        = string
  default     = "lists.life-sqrd.com"

  validation {
    condition     = can(regex("^[a-z0-9.-]+$", var.rest_domain_name))
    error_message = "rest_domain_name must be a lowercase DNS hostname."
  }
}

variable "route53_zone_id" {
  description = "Route53 hosted zone containing rest_domain_name."
  type        = string
}

variable "rest_certificate_arn" {
  description = "Issued eu-west-1 ACM certificate covering rest_domain_name."
  type        = string

  validation {
    condition     = can(regex("^arn:aws:acm:[a-z0-9-]+:[0-9]{12}:certificate/", var.rest_certificate_arn))
    error_message = "rest_certificate_arn must be an ACM certificate ARN."
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
