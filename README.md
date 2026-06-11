# Century Padel Backend

Padel court booking API — Hono, Bun, Prisma, PostgreSQL, Redis, Xendit payments.

## Quick links

| Task | Command |
|------|---------|
| Local dev | `bun install && bun run dev` |
| Docker dev | `docker compose up -d` |
| Fresh VPS setup | `./scripts/install-vps.sh` |
| First production deploy | `./scripts/deploy-fresh.sh` |
| Routine code update | `./scripts/update.sh` |
| Database backup | `./scripts/backup-db.sh` |
| Schedule daily backup | `./scripts/setup-backup-cron.sh` |

## Prerequisites

**Local:** Bun 1.3+, PostgreSQL 16+, Redis 7+

**Production (Docker):** Ubuntu/Debian VPS, Docker 24+, 4 GB RAM recommended

## Local development

```bash
cp .env.example .env
bun install
bun run db:push
bun run dev
```

API: `http://localhost:8000`

### Docker development

```bash
cp .env.example .env.local   # or .env — at least one is required
docker compose up -d
```

| Service | URL |
|---------|-----|
| API | http://localhost:8000 |
| Prisma Studio | http://localhost:5555 |
| PostgreSQL | localhost:5433 |
| Redis | localhost:6379 |

## Production deployment (fully containerized)

### 1. Install VPS (once)

```bash
./scripts/install-vps.sh
# Re-login after install for docker group permissions
```

Disables system nginx, installs Docker, configures UFW (SSH + 80 + 443), optional 1 GB swap on 4 GB RAM.

### 2. Configure environment

```bash
cp docker/env.production.template .env.production
nano .env.production
```

Required: `DB_PASSWORD`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `SSL_DOMAIN`, `BASE_URL`, `FRONT_END_URL`

### 3. First deploy

```bash
chmod +x scripts/*.sh scripts/lib/*.sh deploy.sh docker/*.sh
./scripts/deploy-fresh.sh
```

Starts: PostgreSQL, Redis, app, nginx (SSL via Let's Encrypt), email worker, scheduler worker, certbot auto-renewal.

### 4. Updates (routine)

```bash
./scripts/update.sh
```

Pulls code, rebuilds app image with cache (~1–3 min), restarts app + workers only.

```bash
REBUILD_ALL=true ./scripts/update.sh   # Dockerfile or compose changed
CLEAN_BUILD=true ./scripts/update.sh   # corrupted build cache
```

### Database backup (daily → DigitalOcean Spaces)

Backups go to `s3://kms-data/century-padel/db/` only — other bucket folders are untouched.

```bash
# 1. Add Spaces + Resend keys to .env.production (see docker/env.production.template)
# 2. Test a backup
./scripts/backup-db.sh

# 3. Schedule daily at 02:30 (installs AWS CLI v2 if needed)
./scripts/setup-backup-cron.sh
```

Retention: 30 days (configurable via `BACKUP_RETENTION_DAYS`). Restore: `./scripts/restore-db.sh`

On backup failure only, an alert is emailed via Resend to `BACKUP_ALERT_EMAIL` (default: `ciptacodeteam@gmail.com`).

### SSL troubleshooting

```bash
./docker/ssl-init.sh
docker compose -f docker-compose.prod.yml logs nginx certbot
```

## Project structure

```
century-padel-backend/
├── src/
│   ├── routes/          # API routes
│   ├── handlers/        # Request handlers
│   ├── services/        # Business logic
│   ├── workers/         # Email + scheduler workers
│   └── middlewares/
├── prisma/schema.prisma
├── docker/              # nginx, SSL, redis, entrypoints
├── scripts/             # install-vps, deploy-fresh, update
├── docs/                # API & feature documentation
├── docker-compose.yml       # Development
├── docker-compose.prod.yml  # Production
├── Dockerfile
└── deploy.sh            # → scripts/deploy-fresh.sh
```

## npm scripts

| Script | Description |
|--------|-------------|
| `bun run dev` | Dev server with hot reload |
| `bun run build` | Compile TypeScript |
| `bun run start` | Production server |
| `bun run worker:email` | Email queue worker |
| `bun run worker:scheduler` | Booking/payment expiry worker |
| `bun run db:push` | Push Prisma schema |
| `bun run db:seed` | Seed database |
| `bun run test` | Run Vitest |

## Documentation

See [docs/README.md](./docs/README.md) for API references, Xendit guides, and feature docs.

## VPS sizing

A **4 GB RAM / 3 vCPU** VPS is sufficient for this stack (~100–200 concurrent users). The compose file sets memory limits tuned for 4 GB.
