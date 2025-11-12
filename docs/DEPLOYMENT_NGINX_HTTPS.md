# Nginx HTTPS Reverse Proxy Setup Guide

This guide explains how to configure nginx as a reverse proxy to serve your API over HTTPS at `api.quantumsocialclub.id` without exposing port 8000 directly.

## Changes Made

1. **Docker Configuration**: Updated `docker-compose.yml` to bind port 8000 only to localhost (`127.0.0.1:8000:8000`), preventing direct external access while allowing nginx to access it.

## Prerequisites

- Docker and Docker Compose installed on your DigitalOcean droplet
- nginx installed on your DigitalOcean droplet
- SSL certificate for `api.quantumsocialclub.id` (you mentioned you already have this)

## Setup Steps

### 1. Update Docker Configuration

The `docker-compose.yml` has been updated to bind port 8000 only to localhost. Restart your Docker containers:

```bash
cd /path/to/quantum-sport-backend
docker-compose down
docker-compose up -d
```

### 2. Configure Nginx

#### Option A: Using the provided configuration file

1. Copy the example configuration to nginx sites-available:

```bash
sudo cp nginx.conf.example /etc/nginx/sites-available/api.quantumsocialclub.id
```

2. Update the SSL certificate paths in the configuration file to match your certificate location:

```bash
sudo nano /etc/nginx/sites-available/api.quantumsocialclub.id
```

Update these lines if your certificate paths are different:
```nginx
ssl_certificate /etc/nginx/ssl/api.quantumsocialclub.id/fullchain.pem;
ssl_certificate_key /etc/nginx/ssl/api.quantumsocialclub.id/privkey.pem;
```

If you used Let's Encrypt/Certbot, the paths are typically:
```nginx
ssl_certificate /etc/letsencrypt/live/api.quantumsocialclub.id/fullchain.pem;
ssl_certificate_key /etc/letsencrypt/live/api.quantumsocialclub.id/privkey.pem;
```

3. Enable the site:

```bash
sudo ln -s /etc/nginx/sites-available/api.quantumsocialclub.id /etc/nginx/sites-enabled/
```

4. Test nginx configuration:

```bash
sudo nginx -t
```

5. If the test passes, reload nginx:

```bash
sudo systemctl reload nginx
```

#### Option B: Update existing nginx configuration

If you already have an nginx configuration for `api.quantumsocialclub.id`, update it to:

1. Redirect HTTP (port 80) to HTTPS
2. Proxy HTTPS (port 443) requests to `http://127.0.0.1:8000`
3. Set proper proxy headers (Host, X-Real-IP, X-Forwarded-For, X-Forwarded-Proto)

### 3. Configure Firewall (if needed)

Ensure your firewall allows HTTP (80) and HTTPS (443) traffic, but blocks direct access to port 8000:

```bash
# Allow HTTP and HTTPS
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp

# Block direct access to port 8000 (if not already blocked)
sudo ufw deny 8000/tcp

# Check firewall status
sudo ufw status
```

### 4. Verify Setup

1. Test HTTP redirect:
   ```bash
   curl -I http://api.quantumsocialclub.id
   ```
   Should return `301 Moved Permanently` with `Location: https://api.quantumsocialclub.id`

2. Test HTTPS access:
   ```bash
   curl -I https://api.quantumsocialclub.id
   ```
   Should return `200 OK` or your API's response

3. Verify port 8000 is not accessible externally:
   ```bash
   # From another machine (not your droplet)
   curl http://api.quantumsocialclub.id:8000
   ```
   Should timeout or be blocked

4. Test API endpoint:
   ```bash
   curl https://api.quantumsocialclub.id/health
   ```

## Configuration Details

### What the nginx configuration does:

1. **HTTP Server (port 80)**: Redirects all HTTP requests to HTTPS
2. **HTTPS Server (port 443)**: 
   - Serves requests over HTTPS using your SSL certificate
   - Proxies all requests to `http://127.0.0.1:8000` (your Docker container)
   - Sets proper headers for the backend to understand the original request
   - Includes security headers (HSTS, X-Frame-Options, etc.)

### Important Headers:

- `X-Forwarded-Proto: https` - Tells your backend the request was over HTTPS
- `X-Forwarded-For` - Preserves the original client IP
- `Host` - Preserves the original host header

## Troubleshooting

### Issue: nginx can't connect to backend

**Solution**: Check that Docker container is running and bound to localhost:
```bash
docker ps
netstat -tlnp | grep 8000
```

### Issue: SSL certificate errors

**Solution**: Verify certificate paths are correct and files are readable:
```bash
sudo ls -la /etc/nginx/ssl/api.quantumsocialclub.id/
# or
sudo ls -la /etc/letsencrypt/live/api.quantumsocialclub.id/
```

### Issue: 502 Bad Gateway

**Solution**: 
1. Check if Docker container is running: `docker ps`
2. Check nginx error logs: `sudo tail -f /var/log/nginx/api.quantumsocialclub.id.error.log`
3. Verify port binding: `netstat -tlnp | grep 8000`

### Issue: Still can access via :8000

**Solution**: 
1. Verify Docker port binding: Check `docker-compose.yml` shows `127.0.0.1:8000:8000`
2. Restart Docker containers: `docker-compose restart app`
3. Check firewall rules: `sudo ufw status`

## Environment Variables

Make sure your `.env` file includes the correct `BASE_URL`:

```env
BASE_URL=https://api.quantumsocialclub.id
FRONT_END_URL=https://your-frontend-domain.com
```

This ensures your API generates correct URLs in responses (for CORS, redirects, etc.).

## Security Notes

1. Port 8000 is now only accessible from localhost, preventing direct external access
2. All traffic is encrypted via HTTPS
3. HTTP traffic is automatically redirected to HTTPS
4. Security headers are included in responses
5. Consider implementing rate limiting in nginx for additional protection

## Additional Resources

- [Nginx Reverse Proxy Documentation](https://nginx.org/en/docs/http/ngx_http_proxy_module.html)
- [Let's Encrypt Documentation](https://letsencrypt.org/docs/)
- [SSL Labs SSL Test](https://www.ssllabs.com/ssltest/) - Test your SSL configuration

