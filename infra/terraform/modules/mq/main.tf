variable "name" { type = string }
variable "vpc_id" { type = string }
variable "subnet_ids" { type = list(string) }
variable "allowed_security_group_ids" { type = list(string) }
variable "instance_type" {
  type    = string
  default = "mq.m5.large"
}
variable "tags" {
  type    = map(string)
  default = {}
}

resource "random_password" "rabbitmq" {
  length  = 32
  special = false
}

resource "aws_secretsmanager_secret" "rabbitmq" {
  name = "${var.name}-rabbitmq"
  tags = var.tags
}

resource "aws_secretsmanager_secret_version" "rabbitmq" {
  secret_id = aws_secretsmanager_secret.rabbitmq.id
  secret_string = jsonencode({
    username = "surfgen"
    password = random_password.rabbitmq.result
  })
}

resource "aws_security_group" "rabbitmq" {
  name_prefix = "${var.name}-mq-"
  vpc_id      = var.vpc_id
  tags        = var.tags

  ingress {
    from_port       = 5671 # AMQPS
    to_port         = 5671
    protocol        = "tcp"
    security_groups = var.allowed_security_group_ids
  }
  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

resource "aws_mq_broker" "rabbitmq" {
  broker_name        = var.name
  engine_type        = "RabbitMQ"
  engine_version     = "3.13"
  host_instance_type = var.instance_type
  deployment_mode    = "CLUSTER_MULTI_AZ"

  subnet_ids          = var.subnet_ids
  security_groups     = [aws_security_group.rabbitmq.id]
  publicly_accessible = false
  auto_minor_version_upgrade = true

  user {
    username = "surfgen"
    password = random_password.rabbitmq.result
  }

  logs { general = true }

  tags = var.tags
}

output "amqp_endpoint" { value = aws_mq_broker.rabbitmq.instances[0].endpoints[0] }
output "credentials_secret_arn" { value = aws_secretsmanager_secret.rabbitmq.arn }
