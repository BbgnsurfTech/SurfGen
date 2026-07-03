variable "name" { type = string }
variable "cidr" {
  type    = string
  default = "10.42.0.0/16"
}
variable "azs" { type = list(string) }
variable "tags" {
  type    = map(string)
  default = {}
}

module "vpc" {
  source  = "terraform-aws-modules/vpc/aws"
  version = "~> 5.8"

  name = var.name
  cidr = var.cidr
  azs  = var.azs

  private_subnets = [for i, _ in var.azs : cidrsubnet(var.cidr, 4, i)]
  public_subnets  = [for i, _ in var.azs : cidrsubnet(var.cidr, 4, i + 8)]

  enable_nat_gateway     = true
  single_nat_gateway     = false # one per AZ — render traffic is chatty
  enable_dns_hostnames   = true

  # Tags EKS needs for subnet discovery.
  private_subnet_tags = { "kubernetes.io/role/internal-elb" = "1" }
  public_subnet_tags  = { "kubernetes.io/role/elb" = "1" }

  tags = var.tags
}

output "vpc_id" { value = module.vpc.vpc_id }
output "private_subnets" { value = module.vpc.private_subnets }
output "public_subnets" { value = module.vpc.public_subnets }
