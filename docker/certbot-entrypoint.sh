#!/bin/sh
# Renew certificates via webroot and reload nginx (SIGHUP) after a successful renewal.

set -e

NGINX_CONTAINER="${NGINX_CONTAINER:-century-padel-nginx-prod}"
RELOAD_HOOK="/etc/letsencrypt/reload-nginx.sh"

cat > "$RELOAD_HOOK" << EOF
#!/bin/sh
if [ -S /var/run/docker.sock ]; then
  curl -sf --unix-socket /var/run/docker.sock -X POST \\
    "http://localhost/containers/${NGINX_CONTAINER}/kill?signal=HUP" \\
    >/dev/null 2>&1 || true
fi
EOF

chmod +x "$RELOAD_HOOK"

trap exit TERM

echo "[certbot] Starting renewal loop (checks every 12 hours)"
while :; do
  certbot renew \
    --webroot \
    --webroot-path=/var/www/certbot \
    --deploy-hook "$RELOAD_HOOK" \
    --quiet || true

  sleep 12h & wait $!
done
