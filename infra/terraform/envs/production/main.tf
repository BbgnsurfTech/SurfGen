terraform {
  required_version = ">= 1.7"
  required_providers {
    aws    = { source = "hashicorp/aws", version = "~> 5.50" }
    random = { source = "hashicorp/random", version = "~> 3.6" }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "us-east-1"
}
variable "name" {
  type    = string
  default = "surfgen-prod"
}
variable "gpu_desired_size" {
  type    = number
  default = 0 # bump when local GPU providers (sadtalker/wav2lip) should run in-cluster
}

locals {
  azs  = ["${var.region}a", "${var.region}b", "${var.region}c"]
  tags = { Project = "surfgen", Environment = "production", ManagedBy = "terraform" }
}

module "network" {
  source = "../../modules/network"
  name   = var.name
  azs    = local.azs
  tags   = local.tags
}

module "eks" {
  source           = "../../modules/eks"
  name             = var.name
  vpc_id           = module.network.vpc_id
  subnet_ids       = module.network.private_subnets
  gpu_desired_size = var.gpu_desired_size
  tags             = local.tags
}

module "rds" {
  source                     = "../../modules/rds"
  name                       = var.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnets
  allowed_security_group_ids = [module.eks.cluster_security_group_id]
  tags                       = local.tags
}

module "redis" {
  source                     = "../../modules/redis"
  name                       = var.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnets
  allowed_security_group_ids = [module.eks.cluster_security_group_id]
  tags                       = local.tags
}

module "mq" {
  source                     = "../../modules/mq"
  name                       = var.name
  vpc_id                     = module.network.vpc_id
  subnet_ids                 = module.network.private_subnets
  allowed_security_group_ids = [module.eks.cluster_security_group_id]
  tags                       = local.tags
}

module "storage" {
  source            = "../../modules/storage"
  name              = "${var.name}-media"
  oidc_provider_arn = module.eks.oidc_provider_arn
  tags              = local.tags
}

output "cluster_name" { value = module.eks.cluster_name }
output "db_endpoint" { value = module.rds.endpoint }
output "db_secret_arn" { value = module.rds.master_user_secret_arn }
output "redis_endpoint" { value = module.redis.endpoint }
output "amqp_endpoint" { value = module.mq.amqp_endpoint }
output "mq_secret_arn" { value = module.mq.credentials_secret_arn }
output "media_bucket" { value = module.storage.bucket_name }
output "irsa_role_arn" { value = module.storage.irsa_role_arn }
output "cdn_domain" { value = module.storage.cdn_domain }
