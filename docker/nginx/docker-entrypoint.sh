#!/bin/sh
set -e

DOMAIN="${SSL_DOMAIN:-api.centurypadel.id}"
CERT="/etc/letsencrypt/live/${DOMAIN}/fullchain.pem"
CONF_DIR="/etc/nginx/conf.d"
TEMPLATE_DIR="/etc/nginx/templates"

mkdir -p "$CONF_DIR"

if [ -f "$CERT" ]; then
  echo "[nginx] Certificate found for ${DOMAIN} — enabling HTTPS"
  sed "s/__DOMAIN__/${DOMAIN}/g" "${TEMPLATE_DIR}/default.conf.https" > "${CONF_DIR}/default.conf"
else
  echo "[nginx] No certificate for ${DOMAIN} — HTTP-only mode (ACME + proxy)"
  echo "[nginx] Run: ./docker/ssl-init.sh  (or deploy.sh will do this automatically)"
  sed "s/__DOMAIN__/${DOMAIN}/g" "${TEMPLATE_DIR}/default.conf.http-only" > "${CONF_DIR}/default.conf"
fi

nginx -t
exec nginx -g 'daemon off;'
