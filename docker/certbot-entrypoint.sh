#!/bin/sh
# Renew certificates via webroot and reload nginx (SIGHUP) after a successful renewal.
#
# The official certbot image does not ship curl. The previous hook called curl
# against docker.sock, always failed, and hid the error with `|| true` — so
# certs renewed on disk while nginx kept serving the expired one.

set -e

NGINX_CONTAINER="${NGINX_CONTAINER:-century-padel-nginx-prod}"
RELOAD_HOOK="/etc/letsencrypt/reload-nginx.sh"

# Python is always present in certbot/certbot; use it to talk to the Docker API.
cat > "$RELOAD_HOOK" << EOF
#!/usr/bin/env python3
import socket
import sys

SOCK = "/var/run/docker.sock"
CONTAINER = "${NGINX_CONTAINER}"


def main():
    path = "/v1.41/containers/%s/kill?signal=HUP" % CONTAINER
    req = (
        "POST %s HTTP/1.1\\r\\n"
        "Host: localhost\\r\\n"
        "Content-Length: 0\\r\\n"
        "Connection: close\\r\\n"
        "\\r\\n"
    ) % path
    req = req.encode()

    sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    sock.settimeout(10)
    try:
        sock.connect(SOCK)
    except OSError as exc:
        print("[certbot] cannot connect to docker.sock: %s" % exc, file=sys.stderr)
        sys.exit(1)

    try:
        sock.sendall(req)
        chunks = []
        while True:
            chunk = sock.recv(4096)
            if not chunk:
                break
            chunks.append(chunk)
    finally:
        sock.close()

    text = b"".join(chunks).decode("utf-8", "replace")
    status_line = text.split("\\r\\n", 1)[0]
    print("[certbot] nginx SIGHUP via docker API: %s" % status_line)
    parts = status_line.split(" ")
    code = parts[1] if len(parts) > 1 else ""
    if code not in ("200", "204"):
        print(text, file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
EOF

chmod +x "$RELOAD_HOOK"

trap exit TERM

# Reload on start so nginx picks up a cert that was renewed while the hook was broken.
echo "[certbot] Reloading nginx in case the certificate changed since last start"
if ! "$RELOAD_HOOK"; then
  echo "[certbot] Initial nginx reload failed (nginx may not be up yet)" >&2
fi

echo "[certbot] Starting renewal loop (checks every 12 hours)"
while :; do
  echo "[certbot] Running certbot renew at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
  if certbot renew \
    --webroot \
    --webroot-path=/var/www/certbot \
    --deploy-hook "$RELOAD_HOOK"
  then
    echo "[certbot] Renew check finished OK"
  else
    echo "[certbot] Renew check failed; will retry in 12 hours" >&2
  fi

  sleep 12h & wait $!
done
