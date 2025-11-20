#!/bin/bash

# ============================================
# SSL Certificate Setup for api.quantumsocialclub.id
# ============================================
# Fixed version that handles initial certificate request properly

set -e

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m'

print_header() {
    echo ""
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
}

print_info() {
    echo -e "${BLUE}ℹ️  $1${NC}"
}

print_success() {
    echo -e "${GREEN}✅ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠️  $1${NC}"
}

print_error() {
    echo -e "${RED}❌ $1${NC}"
}

DOMAIN="api.quantumsocialclub.id"
EMAIL="${SSL_EMAIL:-admin@quantumsocialclub.id}"

print_header "SSL Certificate Setup - Fixed Version"
print_info "Domain: $DOMAIN"
print_info "Email: $EMAIL"

# Check Docker Compose
if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker compose"
elif command -v docker-compose >/dev/null 2>&1; then
    DOCKER_COMPOSE="docker-compose"
else
    print_error "Docker Compose not found"
    exit 1
fi

# Verify domain is pointing to this server
print_info "Verifying DNS..."
DOMAIN_IP=$(dig +short $DOMAIN | tail -1)
SERVER_IP=$(curl -s ifconfig.me)

if [ -z "$DOMAIN_IP" ]; then
    print_error "Domain $DOMAIN does not resolve to any IP"
    print_warning "Please ensure DNS is configured correctly"
    print_info "Your server IP: $SERVER_IP"
    exit 1
fi

print_info "Domain IP: $DOMAIN_IP"
print_info "Server IP: $SERVER_IP"

if [ "$DOMAIN_IP" != "$SERVER_IP" ]; then
    print_warning "Domain IP ($DOMAIN_IP) differs from server IP ($SERVER_IP)"
    read -p "Continue anyway? (yes/no): " confirm
    if [ "$confirm" != "yes" ]; then
        exit 1
    fi
fi

# Check if certificate already exists
print_info "Checking for existing certificates..."
if $DOCKER_COMPOSE -f docker-compose.prod.yml run --rm certbot certificates 2>/dev/null | grep -q "$DOMAIN"; then
    print_success "Certificate for $DOMAIN already exists!"
    print_info "Certificate info:"
    $DOCKER_COMPOSE -f docker-compose.prod.yml run --rm certbot certificates
    echo ""
    read -p "Do you want to renew it? (yes/no): " renew
    if [ "$renew" != "yes" ]; then
        print_info "Using existing certificate"
        print_info "Restarting nginx to ensure it's using the certificate..."
        $DOCKER_COMPOSE -f docker-compose.prod.yml restart nginx
        exit 0
    fi
fi

print_header "Step 1: Prepare Temporary HTTP-Only Config"

# Create temporary nginx config for HTTP only (for Let's Encrypt challenge)
print_info "Creating temporary HTTP-only nginx configuration..."

mkdir -p docker/nginx/conf.d-temp
cat > docker/nginx/conf.d-temp/default.conf << 'EOF'
# Temporary HTTP-only configuration for Let's Encrypt
upstream backend {
    least_conn;
    server app:8000 max_fails=3 fail_timeout=30s;
    keepalive 32;
}

server {
    listen 80;
    server_name api.quantumsocialclub.id;
    
    # Let's Encrypt ACME challenge
    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }
    
    # Proxy to backend for now
    location / {
        proxy_pass http://backend;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
EOF

print_success "Temporary config created"

print_header "Step 2: Start Services with HTTP-Only Config"

# Stop nginx if running
$DOCKER_COMPOSE -f docker-compose.prod.yml stop nginx 2>/dev/null || true

# Start other services
print_info "Starting database, redis, and application..."
$DOCKER_COMPOSE -f docker-compose.prod.yml up -d db redis app

# Wait for app to be ready
print_info "Waiting for application to be ready..."
sleep 15

# Start nginx with temporary config
print_info "Starting nginx with HTTP-only configuration..."
$DOCKER_COMPOSE -f docker-compose.prod.yml run -d \
  --name quantum-sport-nginx-temp \
  -p 80:80 \
  -v "$(pwd)/docker/nginx/conf.d-temp:/etc/nginx/conf.d:ro" \
  -v certbot_certs:/etc/letsencrypt \
  -v certbot_www:/var/www/certbot \
  --network quantum-sport-backend_quantum-sport-network \
  nginx:alpine

sleep 5

print_header "Step 3: Request SSL Certificate"

print_info "Requesting certificate from Let's Encrypt..."
print_warning "This will take 1-2 minutes..."

$DOCKER_COMPOSE -f docker-compose.prod.yml run --rm certbot certonly \
    --webroot \
    --webroot-path=/var/www/certbot \
    --email $EMAIL \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d $DOMAIN

if [ $? -eq 0 ]; then
    print_success "Certificate obtained successfully!"
    
    print_header "Step 4: Switch to HTTPS Configuration"
    
    # Stop temporary nginx
    docker stop quantum-sport-nginx-temp 2>/dev/null || true
    docker rm quantum-sport-nginx-temp 2>/dev/null || true
    
    # Start nginx with full HTTPS config
    print_info "Starting nginx with HTTPS configuration..."
    $DOCKER_COMPOSE -f docker-compose.prod.yml up -d nginx
    
    # Wait for nginx to start
    sleep 5
    
    # Test HTTPS
    print_info "Testing HTTPS connection..."
    if curl -s -o /dev/null -w "%{http_code}" https://$DOMAIN/health | grep -q "200"; then
        print_success "HTTPS is working!"
        print_success "Your API is now accessible at: https://$DOMAIN"
    else
        print_warning "HTTPS endpoint not responding yet (this is normal, give it 10-20 seconds)"
        print_info "Test manually: curl https://$DOMAIN/health"
    fi
    
    print_header "Setup Complete!"
    print_success "SSL certificate is installed and auto-renewal is configured"
    echo ""
    print_info "Your API endpoints:"
    echo "  • https://$DOMAIN/health"
    echo "  • https://$DOMAIN/api/..."
    echo ""
    print_info "Certificate will auto-renew every 12 hours (if needed)"
    
    # Cleanup temp config
    rm -rf docker/nginx/conf.d-temp
    
else
    print_error "Certificate request failed"
    echo ""
    
    # Cleanup
    docker stop quantum-sport-nginx-temp 2>/dev/null || true
    docker rm quantum-sport-nginx-temp 2>/dev/null || true
    rm -rf docker/nginx/conf.d-temp
    
    print_info "Common issues:"
    echo "  1. Domain DNS not pointing to this server"
    echo "  2. Port 80 blocked by firewall"
    echo "  3. Another service using port 80"
    echo ""
    print_info "Troubleshooting:"
    echo "  • Check DNS: dig +short $DOMAIN"
    echo "  • Check firewall: sudo ufw status"
    echo "  • Check port 80: sudo netstat -tlnp | grep :80"
    exit 1
fi

