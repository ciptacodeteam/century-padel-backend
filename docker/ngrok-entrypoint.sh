#!/bin/sh
set -e

echo "Starting ngrok tunnel..."

if [ -z "$NGROK_AUTHTOKEN" ] || [ "$NGROK_AUTHTOKEN" = "replace" ]; then
  echo "NGROK_AUTHTOKEN is not set — skipping ngrok (set a token in .env to enable)"
  sleep infinity
fi

mkdir -p /tmp/ngrok
chmod 755 /tmp/ngrok

echo "Waiting for app on port 8000..."
RETRY=0
until wget -qO- http://app:8000/health >/dev/null 2>&1; do
  RETRY=$((RETRY + 1))
  if [ "$RETRY" -ge 60 ]; then
    echo "App not ready after 60 attempts"
    exit 1
  fi
  sleep 2
done

echo "App is ready, starting ngrok tunnel..."

cat > /tmp/ngrok/ngrok.yml << EOF
version: "2"
authtoken: ${NGROK_AUTHTOKEN}
web_addr: 0.0.0.0:4040
tunnels:
  webhook:
    proto: http
    addr: app:8000
EOF

if [ -n "$NGROK_DOMAIN" ] && [ "$NGROK_DOMAIN" != "replace" ]; then
  echo "Using custom domain: $NGROK_DOMAIN"
  cat >> /tmp/ngrok/ngrok.yml << EOF
    hostname: ${NGROK_DOMAIN}
EOF
fi

chmod 644 /tmp/ngrok/ngrok.yml

ngrok start webhook --config /tmp/ngrok/ngrok.yml &
NGROK_PID=$!

sleep 5

PUBLIC_URL=""
i=1
while [ "$i" -le 30 ]; do
  PUBLIC_URL=$(wget -qO- http://localhost:4040/api/tunnels 2>/dev/null | grep -o '"public_url":"https://[^"]*' | head -1 | cut -d'"' -f4)
  if [ -n "$PUBLIC_URL" ]; then
    break
  fi
  echo "Waiting for ngrok API... (attempt $i/30)"
  sleep 2
  i=$((i + 1))
done

if [ -n "$PUBLIC_URL" ]; then
  echo "Ngrok tunnel established: $PUBLIC_URL"
  echo "Webhook URL: $PUBLIC_URL/webhooks/xendit"
  echo "$PUBLIC_URL" > /tmp/ngrok-url.txt
else
  echo "Failed to get ngrok public URL"
  exit 1
fi

trap 'kill $NGROK_PID 2>/dev/null; exit 0' TERM INT
wait $NGROK_PID
