terraform {
  required_version = ">= 1.5"
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = ">= 5.0"
    }
  }
}

provider "aws" {
  region = var.region

  # Applied to every taggable resource this module creates, so the whole event
  # is easy to find/filter/clean up. Merge in your own via var.tags.
  default_tags {
    tags = merge({
      Project   = "ctf-in-a-box"
      ManagedBy = "terraform"
      Event     = var.name
    }, var.tags)
  }
}
