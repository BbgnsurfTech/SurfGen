variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "cluster_version" {
  type    = string
  default = "1.30"
}
variable "cpu_instance_types" {
  type    = list(string)
  default = ["m6i.xlarge"]
}
variable "gpu_instance_types" {
  type    = list(string)
  default = ["g5.xlarge"]
}
variable "gpu_desired_size" {
  type        = number
  default     = 0 # 0 = no GPU pool; gpu.* capabilities route to cloud providers via config/ai.yaml
  description = "Desired GPU nodes. Set 0 to disable the GPU node group entirely."
}
variable "tags" {
  type    = map(string)
  default = {}
}

module "eks" {
  source  = "terraform-aws-modules/eks/aws"
  version = "~> 20.13"

  cluster_name    = var.name
  cluster_version = var.cluster_version

  vpc_id     = var.vpc_id
  subnet_ids = var.subnet_ids

  enable_irsa                              = true
  cluster_endpoint_public_access           = true
  enable_cluster_creator_admin_permissions = true

  eks_managed_node_groups = merge(
    {
      cpu = {
        instance_types = var.cpu_instance_types
        min_size       = 2
        desired_size   = 3
        max_size       = 20
        labels         = { "surfgen.io/pool" = "cpu" }
      }
    },
    var.gpu_desired_size > 0 ? {
      gpu = {
        instance_types = var.gpu_instance_types
        ami_type       = "AL2_x86_64_GPU"
        min_size       = 0
        desired_size   = var.gpu_desired_size
        max_size       = 10
        labels         = { "surfgen.io/pool" = "gpu", "nvidia.com/gpu.present" = "true" }
        taints = [{
          key    = "nvidia.com/gpu"
          value  = "true"
          effect = "NO_SCHEDULE"
        }]
      }
    } : {}
  )

  tags = var.tags
}

output "cluster_name" { value = module.eks.cluster_name }
output "cluster_endpoint" { value = module.eks.cluster_endpoint }
output "oidc_provider_arn" { value = module.eks.oidc_provider_arn }
output "cluster_security_group_id" { value = module.eks.cluster_security_group_id }
