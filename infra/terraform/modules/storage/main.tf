variable "name" { type = string }
variable "oidc_provider_arn" {
  type        = string
  description = "EKS OIDC provider ARN — grants the surfgen ServiceAccount S3 access via IRSA"
}
variable "service_account" {
  type    = string
  default = "surfgen:surfgen-surfgen" # namespace:name from the Helm chart
}
variable "tags" {
  type    = map(string)
  default = {}
}

module "media_bucket" {
  source  = "terraform-aws-modules/s3-bucket/aws"
  version = "~> 4.1"

  bucket        = var.name
  force_destroy = false

  versioning = { enabled = true } # NFR AVA-6

  server_side_encryption_configuration = {
    rule = {
      apply_server_side_encryption_by_default = { sse_algorithm = "aws:kms" }
    }
  }

  # NFR CST-3: renders cool down; temp artifacts expire.
  lifecycle_rule = [
    {
      id     = "renders-to-ia"
      status = "Enabled"
      filter = { prefix = "org/" }
      transition = [{ days = 30, storage_class = "STANDARD_IA" }]
    },
    {
      id         = "tmp-expiry"
      status     = "Enabled"
      filter     = { prefix = "tmp/" }
      expiration = { days = 7 }
    },
  ]

  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true

  tags = var.tags
}

# IRSA role so pods reach S3 without static keys (Helm serviceAccount.annotations).
module "irsa" {
  source  = "terraform-aws-modules/iam/aws//modules/iam-role-for-service-accounts-eks"
  version = "~> 5.39"

  role_name = "${var.name}-app"

  oidc_providers = {
    main = {
      provider_arn               = var.oidc_provider_arn
      namespace_service_accounts = [var.service_account]
    }
  }

  role_policy_arns = {}

  tags = var.tags
}

resource "aws_iam_role_policy" "bucket_access" {
  name = "${var.name}-bucket"
  role = module.irsa.iam_role_name
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect   = "Allow"
      Action   = ["s3:GetObject", "s3:PutObject", "s3:DeleteObject", "s3:ListBucket"]
      Resource = [module.media_bucket.s3_bucket_arn, "${module.media_bucket.s3_bucket_arn}/*"]
    }]
  })
}

# --------------------------------------------------------------------- CDN
# Opt-in: the default access path is app-generated *S3* signed URLs straight to
# the bucket. S3 signed URLs are NOT valid through CloudFront, so the CDN only
# makes sense with CloudFront signed URLs — it therefore requires a viewer
# key group and stays disabled until a public key is provided.
variable "cdn_public_key_pem" {
  type        = string
  default     = "" # empty = no CDN. Provide the CloudFront signing public key (PEM) to enable.
  description = "PEM public key for CloudFront signed URLs. The app must then sign with the matching private key."
}

locals {
  cdn_enabled = var.cdn_public_key_pem != ""
}

resource "aws_cloudfront_origin_access_control" "media" {
  count                             = local.cdn_enabled ? 1 : 0
  name                              = "${var.name}-oac"
  origin_access_control_origin_type = "s3"
  signing_behavior                  = "always"
  signing_protocol                  = "sigv4"
}

resource "aws_cloudfront_public_key" "media" {
  count       = local.cdn_enabled ? 1 : 0
  name        = "${var.name}-signing"
  encoded_key = var.cdn_public_key_pem
}

resource "aws_cloudfront_key_group" "media" {
  count = local.cdn_enabled ? 1 : 0
  name  = "${var.name}-signers"
  items = [aws_cloudfront_public_key.media[0].id]
}

resource "aws_cloudfront_distribution" "media" {
  count   = local.cdn_enabled ? 1 : 0
  enabled = true
  comment = "SurfGen media CDN (CloudFront signed URLs required)"

  origin {
    domain_name              = module.media_bucket.s3_bucket_bucket_regional_domain_name
    origin_id                = "media"
    origin_access_control_id = aws_cloudfront_origin_access_control.media[0].id
  }

  default_cache_behavior {
    target_origin_id       = "media"
    viewer_protocol_policy = "redirect-to-https"
    allowed_methods        = ["GET", "HEAD"]
    cached_methods         = ["GET", "HEAD"]
    # Every request must carry a valid CloudFront signed URL/cookie.
    trusted_key_groups = [aws_cloudfront_key_group.media[0].id]
    # AWS managed CachingOptimized policy.
    cache_policy_id = "658327ea-f89d-4fab-a63d-7e88639e58f6"
  }

  restrictions {
    geo_restriction { restriction_type = "none" }
  }

  viewer_certificate { cloudfront_default_certificate = true }

  tags = var.tags
}

# Without this the OAC cannot read the bucket at all; scope it to this
# distribution so no other CloudFront distribution can front the bucket.
resource "aws_s3_bucket_policy" "cdn_read" {
  count  = local.cdn_enabled ? 1 : 0
  bucket = module.media_bucket.s3_bucket_id
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Sid       = "AllowCloudFrontOAC"
      Effect    = "Allow"
      Principal = { Service = "cloudfront.amazonaws.com" }
      Action    = "s3:GetObject"
      Resource  = "${module.media_bucket.s3_bucket_arn}/*"
      Condition = {
        StringEquals = { "AWS:SourceArn" = aws_cloudfront_distribution.media[0].arn }
      }
    }]
  })
}

output "bucket_name" { value = module.media_bucket.s3_bucket_id }
output "irsa_role_arn" { value = module.irsa.iam_role_arn }
output "cdn_domain" { value = local.cdn_enabled ? aws_cloudfront_distribution.media[0].domain_name : null }
