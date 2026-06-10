#!/bin/bash
# One-time: authorize the GitHub Actions deploy key on this VPS.
# Run ON THE VPS as the deploy user (e.g. nanda):
#
#   curl -fsSL .../setup-github-deploy-key.sh | bash
#   # or after git pull:
#   bash scripts/setup-github-deploy-key.sh "ssh-ed25519 AAAA... comment"
#
# Paste the PUBLIC key only (contents of century-padel-github-deploy.pub).

set -e

PUBLIC_KEY="${1:-}"

if [ -z "$PUBLIC_KEY" ]; then
  echo "Usage: $0 \"ssh-ed25519 AAAA... github-actions-century-padel-deploy\""
  echo ""
  echo "Get the public key from your machine:"
  echo "  cat ~/.ssh/century-padel-github-deploy.pub"
  exit 1
fi

mkdir -p ~/.ssh
chmod 700 ~/.ssh
touch ~/.ssh/authorized_keys
chmod 600 ~/.ssh/authorized_keys

if grep -qF "$PUBLIC_KEY" ~/.ssh/authorized_keys 2>/dev/null; then
  echo "✅ Public key already in ~/.ssh/authorized_keys"
else
  echo "$PUBLIC_KEY" >> ~/.ssh/authorized_keys
  echo "✅ Public key added to ~/.ssh/authorized_keys"
fi

# Deploy user must run docker without sudo
if groups | grep -q docker; then
  echo "✅ User is in docker group"
else
  echo "⚠️  Add this user to docker: sudo usermod -aG docker $(whoami) && newgrp docker"
fi

echo ""
echo "Test from your PC (using the deploy private key):"
echo "  ssh -i ~/.ssh/century-padel-github-deploy -p 22 $(whoami)@$(curl -s ifconfig.me 2>/dev/null || echo YOUR_VPS_IP) 'cd ~/century-padel-backend && git rev-parse --short HEAD'"
