# Resolving Nginx Port Conflict

## Problem

When deploying to production, you may encounter this error:
```
Error response from daemon: failed to bind host port 0.0.0.0:80/tcp: address already in use
```

This happens when system nginx (or another service) is already using port 80.

## Solution Options

### Option 1: Stop System Nginx and Use Docker Nginx (Recommended)

This is the recommended approach for a fully containerized setup:

```bash
# Stop and disable system nginx
sudo systemctl stop nginx
sudo systemctl disable nginx

# Verify it's stopped
sudo lsof -i :80

# Now deploy
./deploy.sh
```

**Pros:**
- Fully containerized setup
- Easier to manage and update
- Consistent with Docker Compose architecture

**Cons:**
- Need to migrate any existing nginx configs to Docker

### Option 2: Use System Nginx and Disable Docker Nginx

If you prefer to use your system nginx:

1. **Comment out nginx service in docker-compose.prod.yml:**
   ```yaml
   # nginx:
   #   image: nginx:alpine
   #   ...
   ```

2. **Configure system nginx to proxy to your app:**

   Create/edit `/etc/nginx/sites-available/quantum-sport`:
   ```nginx
   server {
       listen 80;
       server_name your-domain.com;

       location / {
           proxy_pass http://localhost:3000;
           proxy_http_version 1.1;
           proxy_set_header Upgrade $http_upgrade;
           proxy_set_header Connection 'upgrade';
           proxy_set_header Host $host;
           proxy_set_header X-Real-IP $remote_addr;
           proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
           proxy_set_header X-Forwarded-Proto $scheme;
           proxy_cache_bypass $http_upgrade;
       }
   }
   ```

   Enable the site:
   ```bash
   sudo ln -s /etc/nginx/sites-available/quantum-sport /etc/nginx/sites-enabled/
   sudo nginx -t
   sudo systemctl reload nginx
   ```

**Pros:**
- Keep existing nginx setup
- Can manage SSL certificates with certbot easily
- More control over nginx configuration

**Cons:**
- Need to manage nginx separately from Docker
- Less portable

### Option 3: Use Different Ports for Docker Nginx

If you want to run both:

1. **Set environment variables in `.env.production`:**
   ```bash
   NGINX_HTTP_PORT=8080
   NGINX_HTTPS_PORT=8443
   ```

2. **Or manually edit docker-compose.prod.yml:**
   ```yaml
   ports:
     - '8080:80'
     - '8443:443'
   ```

3. **Configure system nginx to proxy to Docker nginx:**
   ```nginx
   location / {
       proxy_pass http://localhost:8080;
       # ... other proxy settings
   }
   ```

**Pros:**
- Can run both simultaneously
- Flexible setup

**Cons:**
- More complex configuration
- Extra network hop

## Recommended Approach

For a clean production setup, **Option 1** is recommended:
- Stop system nginx
- Use Docker nginx container
- Manage everything through Docker Compose

## Migration from System Nginx

If you have existing nginx configurations you want to migrate:

1. **Copy your configs:**
   ```bash
   sudo cp -r /etc/nginx/sites-available/* ./docker/nginx/conf.d/
   sudo cp /etc/nginx/nginx.conf ./docker/nginx/nginx.conf
   ```

2. **Update paths in configs** (nginx runs in container, so paths are relative to container)

3. **Stop system nginx and deploy with Docker**

## Verification

After choosing an option, verify:

```bash
# Check what's listening on port 80
sudo lsof -i :80

# Check Docker containers
docker-compose -f docker-compose.prod.yml ps

# Test the application
curl http://localhost:3000/health
```

## Troubleshooting

### If Docker nginx still can't start:

1. **Check for other services:**
   ```bash
   sudo netstat -tulpn | grep :80
   sudo ss -tulpn | grep :80
   ```

2. **Check Docker containers:**
   ```bash
   docker ps -a | grep nginx
   docker-compose -f docker-compose.prod.yml ps
   ```

3. **Remove old containers:**
   ```bash
   docker-compose -f docker-compose.prod.yml down
   docker-compose -f docker-compose.prod.yml up -d
   ```

