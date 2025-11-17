# SSL Quick Setup for api.quantumsocialclub.id

## ⚡ One-Command Setup

```bash
cd ~/quantum-sport-backend
git pull origin main
chmod +x docker/setup-ssl.sh
./docker/setup-ssl.sh
```

**Done!** Your API will be available at `https://api.quantumsocialclub.id`

## ✅ Before Running

Make sure:
1. DNS is configured (domain points to your server)
2. Ports 80 and 443 are open
3. No other service on port 80

**Verify DNS:**
```bash
dig +short api.quantumsocialclub.id
# Should return your server IP
```

**Open ports:**
```bash
sudo ufw allow 80/tcp
sudo ufw allow 443/tcp
```

## 🎯 What It Does

1. Verifies DNS configuration
2. Requests SSL certificate from Let's Encrypt
3. Configures nginx with HTTPS
4. Sets up auto-renewal (every 12 hours)
5. Tests HTTPS connection

## ⏱️ Expected Time

**2-3 minutes** for complete SSL setup

## 📝 After Setup

Your API endpoints:
- `https://api.quantumsocialclub.id/health`
- `https://api.quantumsocialclub.id/api/...`

HTTP automatically redirects to HTTPS ✅

## 🔄 Certificate Renewal

Automatic! Checks every 12 hours and renews when needed (30 days before expiry).

## 🆘 If Setup Fails

```bash
# Check logs
docker-compose -f docker-compose.prod.yml logs nginx
docker-compose -f docker-compose.prod.yml logs certbot

# Common fixes
dig +short api.quantumsocialclub.id  # Verify DNS
sudo netstat -tlnp | grep :80         # Check port 80
sudo ufw status                        # Check firewall

# Try again
./docker/setup-ssl.sh
```

## 📚 Full Guide

See [DOMAIN_AND_SSL_SETUP.md](./DOMAIN_AND_SSL_SETUP.md) for complete documentation.

---

**Ready?** Run `./docker/setup-ssl.sh` now! 🚀

