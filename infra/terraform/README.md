# SurfGen Terraform (AWS reference)

Reference infrastructure for a production SurfGen deployment on AWS. Modules wrap the community-maintained [`terraform-aws-modules`](https://registry.terraform.io/namespaces/terraform-aws-modules) registry modules rather than hand-rolling resources — SurfGen-specific opinions (sizing, GPU node pools, queue-class separation) live here; VPC/EKS/RDS plumbing stays upstream.

```
terraform/
├── modules/
│   ├── network/    # VPC, 3 AZs, private app subnets, NAT
│   ├── eks/        # cluster + cpu/gpu managed node groups
│   ├── rds/        # PostgreSQL 16, multi-AZ, PITR backups
│   ├── redis/      # ElastiCache Redis 7 (BullMQ)
│   ├── mq/         # Amazon MQ for RabbitMQ (surfgen.events)
│   └── storage/    # S3 media bucket + CloudFront CDN
└── envs/
    └── production/ # composition root — the only place with literals
```

Usage:

```bash
cd envs/production
terraform init
terraform plan -var-file=production.tfvars
```

Then deploy the app with the Helm chart in `infra/k8s/helm/surfgen`, pointing `existingSecret` at the endpoints these modules output (wire them via external-secrets or SSM — never commit them).

Notes:

- GPU node group is optional (`gpu_desired_size = 0` disables it); a GPU-less cluster routes `gpu.*` capabilities to cloud providers in `config/ai.yaml` — same images, config-only change (ADR-003/ADR-010).
- State backend (S3 + DynamoDB lock) is declared in `envs/production/backend.tf`; create the bucket once out-of-band.
- These are reference modules: review sizing, deletion protection, and network CIDRs before real use.
