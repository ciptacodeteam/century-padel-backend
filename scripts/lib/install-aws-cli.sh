#!/bin/bash
# Install AWS CLI v2 (official bundle).
# Ubuntu 24.04+ no longer ships the legacy `awscli` apt package.

set -euo pipefail

install_aws_cli_v2() {
  if command -v aws >/dev/null 2>&1; then
    print_success "AWS CLI already installed: $(aws --version 2>&1 | head -1)"
    return 0
  fi

  print_header "Installing AWS CLI v2"

  if ! command -v curl >/dev/null 2>&1; then
    print_error "curl is required to install AWS CLI"
    return 1
  fi

  if ! command -v unzip >/dev/null 2>&1; then
    print_info "Installing unzip..."
    if command -v apt-get >/dev/null 2>&1; then
      sudo apt-get update -qq
      sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq unzip
    else
      print_error "unzip is required — install it and re-run"
      return 1
    fi
  fi

  local arch url tmp_dir
  arch="$(uname -m)"
  case "$arch" in
    x86_64 | amd64)
      url="https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip"
      ;;
    aarch64 | arm64)
      url="https://awscli.amazonaws.com/awscli-exe-linux-aarch64.zip"
      ;;
    *)
      print_error "Unsupported CPU architecture for AWS CLI: ${arch}"
      return 1
      ;;
  esac

  tmp_dir="$(mktemp -d)"

  print_info "Downloading AWS CLI v2 (${arch})..."
  curl -fsSL "$url" -o "${tmp_dir}/awscliv2.zip"
  unzip -q "${tmp_dir}/awscliv2.zip" -d "$tmp_dir"

  print_info "Installing to /usr/local/aws-cli (requires sudo)..."
  if [ -x /usr/local/bin/aws ]; then
    sudo "${tmp_dir}/aws/install" --update
  else
    sudo "${tmp_dir}/aws/install"
  fi

  rm -rf "$tmp_dir"

  if ! command -v aws >/dev/null 2>&1; then
    print_error "AWS CLI install finished but 'aws' is not in PATH"
    print_info "Try: export PATH=/usr/local/bin:\$PATH"
    return 1
  fi

  print_success "AWS CLI installed: $(aws --version 2>&1 | head -1)"
}
