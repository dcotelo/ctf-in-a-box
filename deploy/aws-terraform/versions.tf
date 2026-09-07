terraform {
  required_version = ">= 1.10"

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 6.0"
    }
    random = {
      source  = "hashicorp/random"
      version = "~> 3.6"
    }
  }
}

provider "aws" {
  region = var.region

  # Applied to every taggable resource this module creates, so the whole event
  # is easy to find, filter and clean up. Merge in your own via var.tags.
  default_tags {
    tags = merge({
      Project   = "ctf-in-a-box"
      ManagedBy = "terraform"
      Event     = var.name
    }, var.tags)
  }
}
