# Remote state — create the bucket + lock table once, out-of-band:
#   aws s3 mb s3://<your-tf-state-bucket>
#   aws dynamodb create-table --table-name surfgen-tf-lock \
#     --attribute-definitions AttributeName=LockID,AttributeType=S \
#     --key-schema AttributeName=LockID,KeyType=HASH --billing-mode PAY_PER_REQUEST
terraform {
  backend "s3" {
    bucket         = "CHANGE-ME-tf-state"
    key            = "surfgen/production/terraform.tfstate"
    region         = "us-east-1"
    dynamodb_table = "surfgen-tf-lock"
    encrypt        = true
  }
}
