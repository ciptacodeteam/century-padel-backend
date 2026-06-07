#!/bin/bash
# =============================================================================
# Step 1 — Fresh VPS setup (run once on a new server)
# =============================================================================
# Installs: Docker, Docker Compose plugin, Git, UFW firewall, utilities
# Configures: firewall (SSH/80/443), disables conflicting system nginx/apache
# Optional: clones the repository, creates swap for safer Docker builds on 4GB RAM
#
# Usage (on the VPS as a user with sudo):
#   curl -fsSL .../install-vps.sh | bash   # or clone repo first
#   ./scripts/install-vps.sh
#
# Optional environment variables:
#   REPO_URL=https://github.com/you/century-padel.git
#   DEPLOY_PATH=/opt/century-padel
#   DEPLOY_BRANCH=main
#   SETUP_SWAP=true          # default true on <=4GB RAM
#   SKIP_UFW=false
# =============================================================================

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# shellcheck source=lib/common.sh
source "$SCRIPT_DIR/lib/common.sh"

print_header "Century Padel — VPS Installation (Step 1 of 3)"

if [ "$(id -u)" -eq 0 ]; then
  print_warning "Running as root — will not add a user to the docker group automatically"
  DOCKER_USER="${SUDO_USER:-root}"
else
  DOCKER_USER="$(whoami)"
fi

# --- OS check ---
if [ -f /etc/os-release ]; then
  # shellcheck disable=SC1091
  . /etc/os-release
  print_info "OS: ${PRETTY_NAME:-unknown}"
else
  print_warning "Unknown OS — script targets Ubuntu/Debian"
fi

if ! command -v apt-get >/dev/null 2>&1; then
  print_error "This installer requires apt (Ubuntu/Debian). Install Docker manually on other distros."
  exit 1
fi

# --- System packages ---
print_header "Installing system packages"
sudo apt-get update -qq
sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -qq \
  ca-certificates \
  curl \
  git \
  gnupg \
  dnsutils \
  ufw \
  openssl \
  unzip \
  htop

print_success "System packages installed"

# --- Swap (recommended on 4GB during Docker builds) ---
TOTAL_MB=$(free -m | awk '/^Mem:/{print $2}')
SETUP_SWAP="${SETUP_SWAP:-true}"

if [ "$SETUP_SWAP" = "true" ] && [ "$TOTAL_MB" -le 4096 ] && [ ! -f /swapfile ]; then
  print_header "Creating 1GB swap (helps Docker builds on 4GB RAM)"
  sudo fallocate -l 1G /swapfile 2>/dev/null || sudo dd if=/dev/zero of=/swapfile bs=1M count=1024 status=progress
  sudo chmod 600 /swapfile
  sudo mkswap /swapfile
  sudo swapon /swapfile
  if ! grep -q '/swapfile' /etc/fstab; then
    echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab >/dev/null
  fi
  print_success "Swap enabled ($(free -h | awk '/Swap/{print $2}'))"
elif [ -f /swapfile ]; then
  print_info "Swap already configured"
else
  print_info "Skipping swap (SETUP_SWAP=false or RAM > 4GB)"
fi

# --- Stop conflicting web servers ---
print_header "Disabling system nginx/apache (fully containerized setup)"
for svc in nginx apache2 httpd; do
  if systemctl is-active --quiet "$svc" 2>/dev/null; then
    sudo systemctl stop "$svc"
    print_info "Stopped $svc"
  fi
  if systemctl is-enabled --quiet "$svc" 2>/dev/null; then
    sudo systemctl disable "$svc"
    print_info "Disabled $svc"
  fi
done

# --- Docker ---
print_header "Installing Docker Engine + Compose plugin"

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  print_success "Docker already installed: $(docker --version)"
else
  print_info "Installing Docker via get.docker.com..."
  curl -fsSL https://get.docker.com | sudo sh
  print_success "Docker installed"
fi

sudo systemctl enable docker
sudo systemctl start docker

if [ "$DOCKER_USER" != "root" ] && id "$DOCKER_USER" >/dev/null 2>&1; then
  sudo usermod -aG docker "$DOCKER_USER"
  print_success "Added user '$DOCKER_USER' to docker group (log out/in or run: newgrp docker)"
fi

# --- Firewall ---
if [ "${SKIP_UFW:-false}" != "true" ]; then
  print_header "Configuring UFW firewall"
  sudo ufw --force reset >/dev/null 2>&1 || true
  sudo ufw default deny incoming
  sudo ufw default allow outgoing
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp comment 'HTTP'
  sudo ufw allow 443/tcp comment 'HTTPS'
  sudo ufw --force enable
  print_success "UFW enabled (SSH, 80, 443)"
else
  print_warning "Skipping UFW (SKIP_UFW=true)"
fi

# --- Optional clone ---
REPO_URL="${REPO_URL:-}"
DEPLOY_PATH="${DEPLOY_PATH:-$HOME/century-padel}"
DEPLOY_BRANCH="${DEPLOY_BRANCH:-main}"

if [ -n "$REPO_URL" ]; then
  print_header "Cloning repository"
  mkdir -p "$(dirname "$DEPLOY_PATH")"
  if [ -d "$DEPLOY_PATH/.git" ]; then
    print_info "Repository already exists at $DEPLOY_PATH — pulling latest"
    git -C "$DEPLOY_PATH" fetch origin
    git -C "$DEPLOY_PATH" checkout "$DEPLOY_BRANCH"
    git -C "$DEPLOY_PATH" pull origin "$DEPLOY_BRANCH"
  else
    git clone --branch "$DEPLOY_BRANCH" --depth 1 "$REPO_URL" "$DEPLOY_PATH"
  fi
  print_success "Repository ready at $DEPLOY_PATH"
fi

# --- Summary ---
print_header "Installation Complete (Step 1)"
print_success "VPS is ready for deployment"

echo ""
print_info "Next steps:"
echo ""
echo "  1. Log out and back in (or: newgrp docker) so Docker permissions apply"
echo ""
if [ -n "$REPO_URL" ]; then
  echo "  2. Configure environment:"
  echo "     cd $DEPLOY_PATH/century-padel-backend   # adjust if repo layout differs"
  echo "     cp docker/env.production.template .env.production"
  echo "     nano .env.production"
  echo ""
  echo "  3. Run first deploy:"
  echo "     ./scripts/deploy-fresh.sh"
else
  echo "  2. Clone the project (or set REPO_URL and re-run this script):"
  echo "     git clone <your-repo-url> $DEPLOY_PATH"
  echo "     cd $DEPLOY_PATH/century-padel-backend"
  echo ""
  echo "  3. Configure .env.production and run:"
  echo "     ./scripts/deploy-fresh.sh"
fi
echo ""
print_info "For code updates later: ./scripts/update.sh"
