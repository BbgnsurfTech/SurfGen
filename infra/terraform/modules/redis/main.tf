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
  transit_encryption_enabled = false # BullMQ inside the VPC; enable + auth token if crossing boundaries

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
