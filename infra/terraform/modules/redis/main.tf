variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_security_group_ids" { type = list(string) }
variable "node_type" {
  type    = string
  default = "cache.r7g.large"
}
variable "tags" {
  type    = map(string)
  default = {}
}

resource "random_password" "redis_auth" {
  length  = 48
  special = false
}

resource "aws_secretsmanager_secret" "redis_auth" {
  name = "${var.name}-redis-auth"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "redis_auth" {
  secret_id     = aws_secretsmanager_secret.redis_auth.id
  secret_string = random_password.redis_auth.result
}

module "redis" {
  source  = "terraform-aws-modules/elasticache/aws"
  version = "~> 1.2"

  replication_group_id = var.name
  description          = "SurfGen BullMQ queues + rate limits + health caches"

  engine         = "redis"
  engine_version = "7.1"
  node_type      = var.node_type

  num_cache_clusters         = 2
  automatic_failover_enabled = true
  multi_az_enabled           = true
  at_rest_encryption_enabled = true
  # Tenant-derived payloads transit this cluster: TLS + auth required.
  # Clients set REDIS_TLS=true and REDIS_PASSWORD from the secret below.
  transit_encryption_enabled = true
  auth_token                 = random_password.redis_auth.result

  # BullMQ requirement: never evict queue data.
  parameter_group_family = "redis7"
  parameters = [
    { name = "maxmemory-policy", value = "noeviction" },
  ]

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids
  security_group_rules = {
    app_ingress = {
      description                  = "app pods"
      referenced_security_group_id = var.allowed_security_group_ids[0]
    }
  }

  tags = var.tags
}

output "endpoint" { value = module.redis.replication_group_primary_endpoint_address }
output "auth_secret_arn" { value = aws_secretsmanager_secret.redis_auth.arn }
