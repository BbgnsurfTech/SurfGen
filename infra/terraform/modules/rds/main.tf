variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_security_group_ids" { type = list(string) }
variable "instance_class" {
  type    = string
  default = "db.r6g.large"
}
variable "tags" {
  type    = map(string)
  default = {}
}

module "db" {
  source  = "terraform-aws-modules/rds/aws"
  version = "~> 6.7"

  identifier = var.name

  engine               = "postgres"
  engine_version       = "16"
  family               = "postgres16"
  major_engine_version = "16"
  instance_class       = var.instance_class

  allocated_storage     = 100
  max_allocated_storage = 1000
  storage_encrypted     = true

  db_name  = "surfgen"
  username = "surfgen"
  # Password generated + stored in Secrets Manager by the module.
  manage_master_user_password = true

  multi_az                 = true
  backup_retention_period  = 14 # days — PITR per NFR AVA-6
  deletion_protection      = true
  skip_final_snapshot      = false
  performance_insights_enabled = true

  create_db_subnet_group = true
  subnet_ids             = var.subnet_ids

  create_security_group = true
  vpc_security_group_ids = []
  security_group_rules = {
    app_ingress = {
      type                     = "ingress"
      from_port                = 5432
      to_port                  = 5432
      protocol                 = "tcp"
      source_security_group_id = var.allowed_security_group_ids[0]
    }
  }

  tags = var.tags
}

output "endpoint" { value = module.db.db_instance_endpoint }
output "master_user_secret_arn" { value = module.db.db_instance_master_user_secret_arn }
