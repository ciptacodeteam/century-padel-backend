# CI/CD Guide — Docker + GHCR + VPS (Best Practice Reference)

A **standalone** step-by-step reference for building production CI/CD for a containerized API on a single VPS. This documents the pattern used by **Century Padel Backend** and is intended to be reused on future projects.

> **PDF / offline use:** This document includes **complete source code** in [Appendix A](#appendix-a--complete-source-code-copy-paste-ready). You do not need access to the original repository after exporting.
>
> **Export to PDF:**
> - VS Code: install extension **"Markdown PDF"** → right-click this file → `Markdown PDF: Export (pdf)`
> - Pandoc: `pandoc docs/CI_CD_GUIDE.md -o CI_CD_GUIDE.pdf --toc`
> - Browser: open on GitHub → Print → Save as PDF (enable background graphics)

**Customize placeholders** when copying to a new project:

| Placeholder | Replace with |
|---|---|
| `<your-org>` | GitHub org or username (lowercase) |
| `<your-app>` | Image name, e.g. `my-api` |
| `century-padel-app-prod` | Your app container name in compose |
| `8000` | Your app port if different |

---

## Table of contents

### Guide

1. [Philosophy](#1-philosophy)
2. [Architecture overview](#2-architecture-overview)
3. [Prerequisites](#3-prerequisites)
4. [Step 1 — Prepare the VPS](#step-1--prepare-the-vps)
5. [Step 2 — Dockerize the application](#step-2--dockerize-the-application)
6. [Step 3 — Configure compose for registry deploys](#step-3--configure-compose-for-registry-deploys)
7. [Step 4 — Create deploy scripts](#step-4--create-deploy-scripts)
8. [Step 5 — Set up GitHub Container Registry (GHCR)](#step-5--set-up-github-container-registry-ghcr)
9. [Step 6 — Configure GitHub Actions](#step-6--configure-github-actions)
10. [Step 7 — GitHub secrets](#step-7--github-secrets)
11. [Step 8 — First production deploy](#step-8--first-production-deploy)
12. [Step 9 — Routine deploys](#step-9--routine-deploys)
13. [Rollback procedures](#rollback-procedures)
14. [Database schema safety](#database-schema-safety)
15. [Monitoring (recommended add-ons)](#monitoring-recommended-add-ons)
16. [Git hygiene on Linux VPS](#git-hygiene-on-linux-vps)
17. [Troubleshooting](#troubleshooting)
18. [What to skip at small scale](#what-to-skip-at-small-scale)
19. [New project checklist](#new-project-checklist)
20. [File reference](#file-reference)

### Appendix A — Complete source code

- [A.1 GitHub Actions workflow](#a1-github-actions-workflow)
- [A.2 Deploy script (`deploy-registry.sh`)](#a2-deploy-script-deploy-registrysh)
- [A.3 Shared helpers (`common.sh` — deploy section)](#a3-shared-helpers-commonsh--deploy-section)
- [A.4 Dockerfile](#a4-dockerfile)
- [A.5 Container entrypoint](#a5-container-entrypoint)
- [A.6 Docker Compose (app + workers)](#a6-docker-compose-app--workers)
- [A.7 Health endpoint + Docker healthcheck](#a7-health-endpoint--docker-healthcheck)
- [A.8 CI test config (`vitest.config.ts`)](#a8-ci-test-config-vitestconfigts)
- [A.9 `package.json` CI scripts](#a9-packagejson-ci-scripts)
- [A.10 `.gitattributes`](#a10-gitattributes)
- [A.11 `.gitignore` entries](#a11-gitignore-entries)
- [A.12 Generate deploy SSH key](#a12-generate-deploy-ssh-key)

---

## 1. Philosophy

### Core principle: separate build from runtime

| Responsibility | Where it runs | Why |
|---|---|---|
| **Build** (compile, `bun install`, Docker layers) | GitHub Actions runner (ephemeral VM) | Fresh environment, no CPU/RAM competition with live traffic |
| **Store image** | GHCR (GitHub Container Registry) | Immutable artifacts tagged by commit SHA |
| **Run** | VPS pulls image + restarts containers | Production server is a *runtime host*, not a build server |

### What “good” looks like

```
push to main
  → CI gate (lint, typecheck, test)
  → build Docker image on GitHub runner
  → push to ghcr.io/<owner>/<app>:<sha>
  → SSH to VPS → pull image → restart app
  → health check → auto-rollback if unhealthy
```

### Anti-patterns to avoid

- Building Docker images on the production VPS (OOM risk, slow deploys)
- Deploying without a health check
- Overwriting the last-known-good image tag before health passes
- Using `prisma db push` in production without review (silent destructive schema changes)
- Kubernetes / Prometheus / self-hosted Webmin on a single 4 GB VPS

---

## 2. Architecture overview

```mermaid
flowchart TB
  subgraph github [GitHub]
    CODE[Source code]
    ACTIONS[GitHub Actions]
    GHCR[GHCR - container images]
    CODE --> ACTIONS
    ACTIONS -->|build + push| GHCR
  end

  subgraph vps [DigitalOcean VPS]
    GIT[git repo - config only]
    COMPOSE[docker compose]
    APP[app container]
    WORKERS[workers]
    DB[(PostgreSQL)]
    REDIS[(Redis)]
    NGINX[nginx]
    GIT --> COMPOSE
    COMPOSE --> APP
    COMPOSE --> WORKERS
    COMPOSE --> DB
    COMPOSE --> REDIS
    COMPOSE --> NGINX
    NGINX --> APP
    APP --> DB
    APP --> REDIS
  end

  ACTIONS -->|SSH deploy| vps
  GHCR -->|docker pull| APP
```

### What travels where

| Artifact | Delivery mechanism |
|---|---|
| Application code (`src/`) | Baked into Docker image at CI build time |
| Infra config (`docker-compose.prod.yml`, nginx templates, scripts) | `git pull` on VPS during deploy |
| Secrets (`.env.production`) | Stays on VPS only — never in image or git |
| Database data | Docker volume on VPS — never touched by CI |

---

## 3. Prerequisites

### Accounts & services

- GitHub repository (private or public)
- VPS provider (DigitalOcean, Hetzner, etc.) — Ubuntu 22.04+ recommended
- Domain name pointed at VPS (for SSL)

### Local development

- Docker + Docker Compose
- Bun / Node (or your runtime)
- Git

### VPS sizing (Century Padel reference)

- **4 GB RAM / 2–3 vCPU** — sufficient for API + Postgres + Redis + nginx + workers
- Enable swap (1 GB) on 4 GB machines if not already configured

---

## Step 1 — Prepare the VPS

Run once on a fresh server.

```bash
# Clone your project
git clone https://github.com/<org>/<repo>.git
cd <repo>

# Install Docker, configure firewall, optional swap
./scripts/install-vps.sh

# Re-login so docker group membership applies
exit
# SSH back in

# Create production environment file
cp docker/env.production.template .env.production
nano .env.production
# Required: DB_PASSWORD, JWT_SECRET, JWT_REFRESH_SECRET, SSL_DOMAIN, BASE_URL

# First-time full stack deploy (builds locally once — only needed for bootstrap)
./scripts/deploy-fresh.sh
```

### Firewall (UFW)

Allow only what you need:

- SSH (your port)
- HTTP (80) — Let's Encrypt challenge
- HTTPS (443)

Do **not** expose Postgres or Redis publicly.

### Git hygiene on VPS (important)

Prevent `git pull` failures caused by executable-bit drift:

```bash
cd /path/to/project
git config core.fileMode false
```

See [Git hygiene on Linux VPS](#git-hygiene-on-linux-vps) for the full explanation.

---

## Step 2 — Dockerize the application

### Multi-stage Dockerfile

Use a multi-stage build to keep the production image small:

1. **deps** — install production dependencies
2. **builder** — compile TypeScript
3. **runner** — copy only runtime artifacts

Key practices:

- Run as non-root user (`nodejs`)
- Use `dumb-init` for proper signal handling
- Include a container `HEALTHCHECK`
- Run migrations in an **entrypoint script**, not in the Dockerfile

→ **Full code:** [Appendix A.4](#a4-dockerfile) · [A.5](#a5-container-entrypoint) · [A.7](#a7-health-endpoint--docker-healthcheck)

### Entrypoint script (`docker/docker-entrypoint.sh`)

On every container start:

1. Wait for database to be ready (`pg_isready`)
2. Apply schema:
   - If `prisma/migrations/` exists → `prisma migrate deploy`
   - Else → `prisma db push` (dev/small projects only — see [Database schema safety](#database-schema-safety))
3. `prisma generate`
4. Start the application (`exec "$@"`)

### Health endpoint

Expose `GET /health` returning JSON with `"success": true` or `"up": true`. Used by:

- Docker `HEALTHCHECK`
- Deploy script HTTP probe
- GitHub Actions post-deploy verification
- External uptime monitoring (UptimeRobot)

---

## Step 3 — Configure compose for registry deploys

In `docker-compose.prod.yml`, make the app image configurable:

```yaml
app:
  build:
    context: .
    dockerfile: Dockerfile
  image: ${APP_IMAGE:-my-app:latest}   # default for local/first deploy
  # ...

email-worker:
  image: ${APP_IMAGE:-my-app:latest}   # same image, different command

scheduler-worker:
  image: ${APP_IMAGE:-my-app:latest}
```

- **`build:`** stays for first-time / local builds (`deploy-fresh.sh`)
- **`image: ${APP_IMAGE}`** lets CI override with `ghcr.io/...` at deploy time
- Workers share the app image — no separate build

Persist the deployed tag in `.env` on the VPS (done by `persist_app_image()` in deploy scripts) so manual `docker compose` commands use the correct image.

→ **Full code:** [Appendix A.6](#a6-docker-compose-app--workers)

---

## Step 4 — Create deploy scripts

### Script roles

| Script | When to use |
|---|---|
| `scripts/install-vps.sh` | Once — install Docker, UFW, swap |
| `scripts/deploy-fresh.sh` | Once — first production bootstrap (local build) |
| `scripts/deploy-registry.sh` | Every CI deploy — pull prebuilt image, no build |
| `scripts/update.sh` | Fallback — build on VPS (emergency / no registry) |
| `scripts/backup-db.sh` | Daily cron + optional pre-schema-change snapshot |

### `deploy-registry.sh` flow (production deploy)

```
1. Remember previous image (running container → .env → .deploy-last-good-image)
2. export APP_IMAGE=<new tag>  (do NOT persist to .env yet)
3. Optional: git pull (sync compose/nginx/scripts)
4. docker compose pull app
5. docker compose up -d --no-deps app
6. Wait: Docker healthy + HTTP GET /health
7a. Success → persist new tag, save .deploy-last-good-image, restart workers
7b. Failure → rollback to previous image, exit 1
```

### Automatic rollback

On health-check failure:

1. Log recent app container output
2. If a previous image exists and differs from the target → `rollback_app_deployment`
3. Restart app + workers on the old image
4. Exit 1 (GitHub Actions shows red)

The new image tag is **only saved after health passes** — a failed deploy never overwrites the last-known-good tag.

### Marker file

`.deploy-last-good-image` on the VPS (gitignored) stores the last successfully deployed image tag as a rollback fallback.

→ **Full code:** [Appendix A.2](#a2-deploy-script-deploy-registrysh) · [A.3](#a3-shared-helpers-commonsh--deploy-section)

---

## Step 5 — Set up GitHub Container Registry (GHCR)

GHCR is GitHub's Docker image hosting. Free for typical private-repo usage.

### Image naming

```
ghcr.io/<github-owner-lowercase>/<image-name>:<tag>
```

Example:

```
ghcr.io/ciptacodeteam/century-padel-backend:abc123def
ghcr.io/ciptacodeteam/century-padel-backend:latest
```

### Authentication

- **Push (CI):** `GITHUB_TOKEN` with `packages: write` permission — no extra secret
- **Pull (VPS during deploy):** ephemeral `GITHUB_TOKEN` passed over SSH for the duration of the workflow run

No long-lived Personal Access Token required if deploys always go through GitHub Actions.

### Package visibility

Images are **private** by default. The VPS pulls during CI using the workflow token. For manual VPS pulls outside CI, create a read-only PAT with `read:packages` and run `docker login ghcr.io` once on the server.

---

## Step 6 — Configure GitHub Actions

File: `.github/workflows/docker-production.yml`

→ **Full code:** [Appendix A.1](#a1-github-actions-workflow)

### Triggers

```yaml
on:
  push:
    branches: [main]
  workflow_dispatch:
```

### Permissions

```yaml
permissions:
  contents: read
  packages: write   # required for GHCR push
```

### Concurrency (prevent deploy races)

```yaml
concurrency:
  group: production-deploy
  cancel-in-progress: false   # queue overlapping deploys, don't cancel
```

### Job 1: CI gate

Runs on `ubuntu-latest` **before** any build or deploy:

```yaml
test:
  runs-on: ubuntu-latest
  steps:
    - uses: actions/checkout@v6
    - uses: oven-sh/setup-bun@v2
    - run: bun install --frozen-lockfile
    - run: bun run typecheck
    - run: bun run lint
    - run: bun run test
```

**Tip:** If `prisma generate` runs during `postinstall`, set a dummy `DATABASE_URL` in the job `env` — generate is offline and does not need a real database.

### Job 2: Build and deploy

```yaml
build-and-deploy:
  needs: test
  runs-on: ubuntu-latest
```

Steps:

1. **Compute image name** — lowercase owner (GHCR requirement)
2. **Docker Buildx** + login to GHCR
3. **Build and push** with tags:
   - `ghcr.io/<owner>/<app>:${{ github.sha }}` — immutable, for rollbacks
   - `ghcr.io/<owner>/<app>:latest`
   - Use `cache-from/to: type=gha` for fast rebuilds
4. **SSH setup** — deploy key from secrets
5. **Deploy to VPS:**
   - `docker login ghcr.io`
   - `git pull origin main`
   - `APP_IMAGE=... AUTO_DEPLOY=true bash scripts/deploy-registry.sh`
   - `docker logout ghcr.io`
6. **Verify deployment health** — second HTTP probe (belt and suspenders)

### Action versions (Node 24 compatible)

| Action | Version |
|---|---|
| `actions/checkout` | `v6` |
| `docker/setup-buildx-action` | `v4` |
| `docker/login-action` | `v4` |
| `docker/build-push-action` | `v7` |
| `actions/cache` | `v4` |
| `oven-sh/setup-bun` | `v2` |

### YAML gotcha

If a `run:` one-liner contains a colon-space (`Image: `), use a block scalar:

```yaml
run: |
  echo "Deployed image: ${{ env.REGISTRY }}/..."
```

---

## Step 7 — GitHub secrets

Configure in **Repository → Settings → Secrets and variables → Actions**.

→ **Full setup commands:** [Appendix A.12](#a12-generate-deploy-ssh-key)

| Secret | Example | Purpose |
|---|---|---|
| `DO_HOST` | `123.45.67.89` | VPS IP or hostname |
| `DO_USERNAME` | `deploy` | SSH user |
| `DO_SSH_PORT` | `22` | SSH port |
| `DO_PROJECT_PATH` | `/home/deploy/century-padel-backend` | Absolute path to project on VPS |
| `DO_SSH_PRIVATE_KEY` | `-----BEGIN OPENSSH PRIVATE KEY-----...` | Deploy key (matches VPS `authorized_keys`) |
| `DO_SSH_PRIVATE_KEY_B64` | base64 of key | Alternative if multiline secret breaks on Windows |

**Not needed:** GHCR token (uses built-in `GITHUB_TOKEN`).

### Generate a deploy SSH key

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""
# Public key → VPS ~/.ssh/authorized_keys
# Private key → GitHub secret DO_SSH_PRIVATE_KEY
```

Restrict the deploy user: no root, docker group only, key-only auth.

---

## Step 8 — First production deploy

One-time bootstrap on the VPS (before CI takes over):

```bash
./scripts/install-vps.sh
cp docker/env.production.template .env.production
# edit .env.production
./scripts/deploy-fresh.sh    # builds locally, starts full stack + SSL
```

After that, **all routine deploys go through GitHub Actions** pushing to `main`.

### Verify CI pipeline

1. Push a small change to `main`
2. Watch GitHub Actions: `test` → `build-and-deploy`
3. Confirm GHCR package appears under GitHub → Packages
4. On VPS: `docker compose -f docker-compose.prod.yml ps` — all healthy
5. `curl -s https://<your-domain>/health`

---

## Step 9 — Routine deploys

### Automatic (recommended)

```bash
git push origin main
```

GitHub Actions handles everything. Typical timeline:

| Stage | Duration |
|---|---|
| CI gate (lint, test) | 1–3 min |
| Docker build + push | 2–5 min (cached: ~1 min) |
| VPS pull + restart | 30–90 sec |
| Health verification | up to ~1 min |

### Manual registry deploy (on VPS)

```bash
APP_IMAGE=ghcr.io/<owner>/<app>:<tag> ./scripts/deploy-registry.sh
```

Use for rollbacks or if CI is unavailable.

### Fallback: build on VPS

```bash
./scripts/update.sh
```

Only when registry is unreachable. Uses VPS CPU/RAM — avoid for routine deploys.

---

## Rollback procedures

### Automatic (built into `deploy-registry.sh`)

If the new image fails health checks, the script rolls back to the previous running image and exits 1. No manual action needed — the API should come back on the old version.

### Manual rollback to a specific commit

Every CI build tags the image with the full git SHA:

```bash
# On VPS
APP_IMAGE=ghcr.io/<owner>/<app>:<commit-sha> ./scripts/deploy-registry.sh
```

Find the SHA in GitHub Actions logs or `git log`.

### Manual rollback using last-good marker

```bash
cat .deploy-last-good-image
APP_IMAGE=$(cat .deploy-last-good-image) ./scripts/deploy-registry.sh
```

### Database rollback (separate from image rollback)

Image rollback does **not** undo schema changes. If a bad migration altered the database:

```bash
./scripts/restore-db.sh                    # list backups
./scripts/restore-db.sh century_padel_YYYYMMDD_HHMMSS.dump
```

See [Database schema safety](#database-schema-safety).

---

## Database schema safety

### The problem

| Action | Reversible by image rollback? |
|---|---|
| Bad application code | ✅ Yes — redeploy old image |
| Bad `prisma db push` / migration | ❌ No — database state already changed |

### Layer 1 — Use Prisma migrations (prevent)

Replace `db push` in production with versioned migrations:

```bash
# Local — create migration from schema changes
bun run db:migrate

# Commit prisma/migrations/ to git
git add prisma/migrations/
git commit -m "db: add remarks column to bookings"
```

Once `prisma/migrations/` exists, the container entrypoint automatically uses `prisma migrate deploy` instead of `db push`. Migration SQL is reviewed in PRs before it reaches production.

### Layer 2 — Pre-deploy backup (insurance)

Before schema-changing deploys, snapshot the database:

```bash
./scripts/backup-db.sh
```

Consider wiring this into `deploy-registry.sh` when `prisma/` files change in the deploy diff. Backups go to DigitalOcean Spaces (see `scripts/backup-db.sh`).

### Layer 3 — Expand-contract pattern (discipline)

For risky schema changes, split across multiple deploys so old code still works with new schema:

```
Deploy 1 (expand):  add new column, code writes to both old and new
Deploy 2 (switch):  code reads from new column only
Deploy 3 (contract): drop old column
```

This makes image-only rollback safe at every step.

### Current Century Padel status

- Entrypoint supports both `migrate deploy` and `db push`
- No `prisma/migrations/` committed yet → production uses `db push`
- **Recommended next step:** create initial migration and commit it

---

## Monitoring (recommended add-ons)

CI/CD handles deploy correctness. These tools alert you when production has problems **between** deploys.

### Free monitoring stack

| Tool | Purpose | Cost |
|---|---|---|
| **UptimeRobot** | External ping of `https://<domain>/health` every 5 min | Free |
| **DigitalOcean Monitoring** | CPU, RAM, disk alerts on droplet | Free |
| **Sentry** (optional) | Application error stack traces | Free tier |
| **Resend email** (already configured) | Backup failure alerts | Per usage |

### UptimeRobot setup

1. Monitor type: HTTP(s)
2. URL: `https://api.example.com/health`
3. Keyword: `success` (fails if body is wrong even when HTTP 200)
4. Alert: email + optional Telegram

### What NOT to add on a 4 GB VPS

- Prometheus + Grafana (too heavy)
- Self-hosted Uptime Kuma (another container to maintain)
- Webmin exposed on port 10000 (security risk; use DO dashboard instead)

---

## Git hygiene on Linux VPS

### The chmod problem

If shell scripts are stored as mode `644` in git but the deploy runs `chmod +x` on the VPS, Linux git (`core.fileMode=true`) sees them as modified. The next `git pull` fails:

```
error: Your local changes would be overwritten by merge.
```

### Fix (both sides)

**1. Store executable bit in the repo:**

```bash
git ls-files '*.sh' | xargs git update-index --chmod=+x
git commit -m "chore: mark shell scripts executable"
```

**2. On the VPS:**

```bash
git config core.fileMode false
```

**3. `.gitattributes` (prevent CRLF on Windows):**

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
```

### Line endings

| Location | Ending |
|---|---|
| Repo (what VPS gets) | LF |
| Windows working copy | May show CRLF locally — git normalizes on commit |

---

## Troubleshooting

### `git pull` fails on VPS during deploy

```bash
cd $PROJECT_PATH
git status                  # look for modified scripts
git config core.fileMode false
git stash                   # or git checkout -- scripts/
git pull origin main
```

### GHCR pull fails (unauthorized)

- Ensure workflow passes `GITHUB_TOKEN` to `docker login` on VPS
- For manual pulls: `echo <PAT> | docker login ghcr.io -u <user> --password-stdin`

### Health check fails after deploy

```bash
docker compose -f docker-compose.prod.yml logs --tail=50 app
docker compose -f docker-compose.prod.yml ps
curl -s http://127.0.0.1:8000/health
```

Check `.deploy-last-good-image` for rollback tag.

### Node 20 deprecation warning in Actions

Update action majors to Node 24-compatible versions (see [Action versions](#action-versions-node-24-compatible)).

### VPS disk full after switching from local builds

Old Docker build cache is unused after moving to GHCR pulls:

```bash
docker system df
docker builder prune -af    # safe — build cache only
docker image prune -af      # safe — dangling images only
# NEVER: docker volume prune (can delete database data)
```

### Prisma migration failed on startup

See [MIGRATION_RECOVERY.md](./MIGRATION_RECOVERY.md).

---

## What to skip at small scale

| Tool | Why skip |
|---|---|
| Kubernetes | One VPS, one app — Docker Compose is enough |
| Prometheus + Grafana | Eats RAM; DO Monitoring covers basics |
| Self-hosted runner | SSH + GHCR works fine; runner on prod adds security surface |
| DOCR (DigitalOcean registry) | GHCR is free and already integrated with GitHub |
| Auto database restore | Too dangerous to automate; keep manual with confirmation |
| Webmin on public internet | Extra attack surface; use SSH + DO dashboard |

---

## New project checklist

Copy this when starting a new project with the same pattern.

### Repository setup

- [ ] Multi-stage `Dockerfile` with non-root user and `HEALTHCHECK`
- [ ] `docker-compose.prod.yml` with `${APP_IMAGE:-...}` for app + workers
- [ ] `docker/docker-entrypoint.sh` (DB wait + migrations + start)
- [ ] `GET /health` endpoint returning `{ success: true }`
- [ ] `scripts/install-vps.sh`, `deploy-fresh.sh`, `deploy-registry.sh`
- [ ] `scripts/lib/common.sh` with rollback helpers
- [ ] `.gitattributes` — `*.sh text eol=lf`
- [ ] Shell scripts committed as mode `755`
- [ ] `.gitignore` — `.env*`, `.deploy-last-good-image`, `.backups/`
- [ ] `vitest.config.ts` + CI test scripts in `package.json`

### GitHub setup

- [ ] `.github/workflows/docker-production.yml`
  - [ ] `test` job (lint, typecheck, test)
  - [ ] `build-and-deploy` job (needs: test)
  - [ ] GHCR push with `:${{ github.sha }}` and `:latest` tags
  - [ ] SSH deploy running `deploy-registry.sh`
  - [ ] Post-deploy health verification
  - [ ] `concurrency` group for production
  - [ ] Node 24-compatible action versions
- [ ] Secrets: `DO_HOST`, `DO_USERNAME`, `DO_SSH_PORT`, `DO_PROJECT_PATH`, `DO_SSH_PRIVATE_KEY`

### VPS setup (once)

- [ ] Ubuntu + Docker installed
- [ ] UFW: SSH, 80, 443 only
- [ ] `.env.production` configured
- [ ] `deploy-fresh.sh` completed successfully
- [ ] SSL working (`curl https://<domain>/health`)
- [ ] `git config core.fileMode false`
- [ ] Daily DB backup cron (`scripts/setup-backup-cron.sh`)

### Post-launch

- [ ] UptimeRobot monitoring `/health`
- [ ] DO Monitoring alerts (CPU > 80%, disk > 80%)
- [ ] Prisma migrations committed (replace `db push` in prod)
- [ ] Sentry DSN configured (optional)

---

## File reference

| File | Role |
|---|---|
| `.github/workflows/docker-production.yml` | CI/CD pipeline |
| `Dockerfile` | Multi-stage production image |
| `docker-compose.prod.yml` | Production stack definition |
| `docker/docker-entrypoint.sh` | DB wait, schema sync, app start |
| `scripts/deploy-registry.sh` | Pull-based deploy with auto-rollback |
| `scripts/deploy-fresh.sh` | First-time bootstrap (local build) |
| `scripts/update.sh` | Fallback on-VPS build deploy |
| `scripts/lib/common.sh` | Shared helpers (health probe, rollback) |
| `scripts/backup-db.sh` | Database backup to Spaces |
| `scripts/restore-db.sh` | Database restore from Spaces |
| `.deploy-last-good-image` | VPS marker — last healthy image tag (gitignored) |
| `.env` (on VPS) | Compose interpolation — `APP_IMAGE=...` |
| `.env.production` (on VPS) | Application secrets (never in git) |

---

## Appendix A — Complete source code (copy-paste ready)

All files below are production-tested. Replace `<your-org>` and `<your-app>` for new projects.

---

### A.1 GitHub Actions workflow

**File:** `.github/workflows/docker-production.yml`

```yaml
name: Build & Deploy to DigitalOcean

on:
  push:
    branches:
      - main
  workflow_dispatch:

permissions:
  contents: read
  packages: write

concurrency:
  group: production-deploy
  cancel-in-progress: false

env:
  REGISTRY: ghcr.io

jobs:
  test:
    name: Lint, typecheck & test
    runs-on: ubuntu-latest
    env:
      DATABASE_URL: postgresql://ci:ci@localhost:5432/ci?schema=public

    steps:
      - uses: actions/checkout@v6

      - uses: oven-sh/setup-bun@v2
        with:
          bun-version: '1.3'

      - uses: actions/cache@v4
        with:
          path: ~/.bun/install/cache
          key: ${{ runner.os }}-bun-${{ hashFiles('bun.lock') }}
          restore-keys: |
            ${{ runner.os }}-bun-

      - run: bun install --frozen-lockfile
      - run: bun run typecheck
      - run: bun run lint
      - run: bun run test

  build-and-deploy:
    name: Build image & deploy
    needs: test
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v6

      - name: Compute image name
        id: img
        run: |
          OWNER="$(echo '${{ github.repository_owner }}' | tr '[:upper:]' '[:lower:]')"
          echo "name=${OWNER}/<your-app>" >> "$GITHUB_OUTPUT"

      - uses: docker/setup-buildx-action@v4

      - uses: docker/login-action@v4
        with:
          registry: ${{ env.REGISTRY }}
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}

      - uses: docker/build-push-action@v7
        with:
          context: .
          file: ./Dockerfile
          push: true
          tags: |
            ${{ env.REGISTRY }}/${{ steps.img.outputs.name }}:${{ github.sha }}
            ${{ env.REGISTRY }}/${{ steps.img.outputs.name }}:latest
          cache-from: type=gha
          cache-to: type=gha,mode=max

      - name: Setup SSH key
        env:
          SSH_KEY: ${{ secrets.DO_SSH_PRIVATE_KEY }}
          SSH_KEY_B64: ${{ secrets.DO_SSH_PRIVATE_KEY_B64 }}
        run: |
          install -m 700 -d ~/.ssh
          if [ -n "$SSH_KEY_B64" ]; then
            echo "$SSH_KEY_B64" | base64 -d > ~/.ssh/deploy_key
          else
            printf '%s\n' "$SSH_KEY" | sed 's/\r$//' > ~/.ssh/deploy_key
          fi
          chmod 600 ~/.ssh/deploy_key
          ssh-keygen -lf ~/.ssh/deploy_key

      - run: ssh-keyscan -H ${{ secrets.DO_HOST }} >> ~/.ssh/known_hosts

      - name: Deploy to VPS
        env:
          APP_IMAGE: ${{ env.REGISTRY }}/${{ steps.img.outputs.name }}:${{ github.sha }}
          REGISTRY: ${{ env.REGISTRY }}
          GHCR_USER: ${{ github.actor }}
          GHCR_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          SSH_OPTS="-i $HOME/.ssh/deploy_key -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -o StrictHostKeyChecking=yes"
          ssh $SSH_OPTS -p ${{ secrets.DO_SSH_PORT }} ${{ secrets.DO_USERNAME }}@${{ secrets.DO_HOST }} \
            "APP_IMAGE='$APP_IMAGE' REGISTRY='$REGISTRY' GHCR_USER='$GHCR_USER' GHCR_TOKEN='$GHCR_TOKEN' PROJECT_PATH='${{ secrets.DO_PROJECT_PATH }}' bash -s" << 'EOF'
          set -e
          cd "$PROJECT_PATH"
          echo "$GHCR_TOKEN" | docker login "$REGISTRY" -u "$GHCR_USER" --password-stdin
          BEFORE_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
          git pull origin main
          AFTER_HEAD="$(git rev-parse HEAD 2>/dev/null || true)"
          CHANGED_FILES="$(git diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD" 2>/dev/null || true)"
          chmod +x scripts/*.sh scripts/lib/*.sh deploy.sh docker/*.sh 2>/dev/null || true
          APP_IMAGE="$APP_IMAGE" CHANGED_FILES="$CHANGED_FILES" AUTO_DEPLOY=true SKIP_PULL_CODE=true bash scripts/deploy-registry.sh
          docker logout "$REGISTRY" || true
          EOF

      - name: Verify deployment health
        run: |
          SSH_OPTS="-i $HOME/.ssh/deploy_key -o IdentitiesOnly=yes -o PreferredAuthentications=publickey -o StrictHostKeyChecking=yes"
          ssh $SSH_OPTS -p ${{ secrets.DO_SSH_PORT }} ${{ secrets.DO_USERNAME }}@${{ secrets.DO_HOST }} \
            "PROJECT_PATH='${{ secrets.DO_PROJECT_PATH }}' bash -s" << 'EOF'
          set -e
          cd "$PROJECT_PATH"
          PORT="$(grep -E '^PORT=' .env.production 2>/dev/null | head -n1 | cut -d= -f2 | tr -d '\r' || true)"
          PORT="${PORT:-8000}"
          for i in $(seq 1 6); do
            if curl -fsS --max-time 5 "http://127.0.0.1:${PORT}/health" 2>/dev/null \
              | grep -qE '"success"[[:space:]]*:[[:space:]]*true|"up"[[:space:]]*:[[:space:]]*true'; then
              echo "Health check passed"
              exit 0
            fi
            sleep 5
          done
          exit 1
          EOF
```

---

### A.2 Deploy script (`deploy-registry.sh`)

**File:** `scripts/deploy-registry.sh`

```bash
#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/lib/common.sh"

print_header "Registry Deploy (pull prebuilt image)"

require_project_root
require_docker
make_scripts_executable

if [ -z "${APP_IMAGE:-}" ]; then
  print_error "APP_IMAGE is required (e.g. ghcr.io/<your-org>/<your-app>:<sha>)"
  exit 1
fi

if [ ! -f "$PROJECT_ROOT/$ENV_FILE" ]; then
  print_error "$ENV_FILE missing — run ./scripts/deploy-fresh.sh first"
  exit 1
fi

validate_env
load_env

TARGET_APP_IMAGE="$APP_IMAGE"

# Remember what was running before we touch anything (for automatic rollback).
PREVIOUS_APP_IMAGE="$(read_running_app_image)"
if [ -z "$PREVIOUS_APP_IMAGE" ]; then
  PREVIOUS_APP_IMAGE="$(read_persisted_app_image)"
fi
if [ -z "$PREVIOUS_APP_IMAGE" ]; then
  PREVIOUS_APP_IMAGE="$(read_last_good_app_image)"
fi

export APP_IMAGE="$TARGET_APP_IMAGE"

if [ "${AUTO_DEPLOY:-}" != "true" ]; then
  read -r -p "Pull and deploy this image? (yes/no): " confirm
  [ "$confirm" = "yes" ] || exit 0
fi

if [ "${SKIP_PULL_CODE:-false}" != "true" ] && [ -d "$PROJECT_ROOT/.git" ]; then
  BEFORE_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || true)"
  git -C "$PROJECT_ROOT" pull origin "${DEPLOY_BRANCH:-main}" || true
  AFTER_HEAD="$(git -C "$PROJECT_ROOT" rev-parse HEAD 2>/dev/null || true)"
  if [ -z "${CHANGED_FILES:-}" ]; then
    CHANGED_FILES="$(git -C "$PROJECT_ROOT" diff --name-only "$BEFORE_HEAD" "$AFTER_HEAD" 2>/dev/null || true)"
  fi
fi

compose -f "$COMPOSE_FILE" pull app
compose -f "$COMPOSE_FILE" up -d --no-deps app

DEPLOY_OK=false
if wait_for_healthy app 30 && probe_app_http_health "$(resolve_app_port)" 12; then
  DEPLOY_OK=true
fi

if [ "$DEPLOY_OK" != true ]; then
  print_error "New deployment failed health checks"
  compose -f "$COMPOSE_FILE" logs --tail=30 app
  if [ -n "$PREVIOUS_APP_IMAGE" ] && [ "$PREVIOUS_APP_IMAGE" != "$TARGET_APP_IMAGE" ]; then
    rollback_app_deployment "$PREVIOUS_APP_IMAGE" && exit 1
  fi
  exit 1
fi

persist_app_image "$TARGET_APP_IMAGE"
save_last_good_app_image "$TARGET_APP_IMAGE"

compose -f "$COMPOSE_FILE" up -d --no-deps email-worker scheduler-worker

if [ -n "${CHANGED_FILES:-}" ] && echo "$CHANGED_FILES" | grep -q 'docker/nginx/'; then
  compose -f "$COMPOSE_FILE" up -d --no-deps nginx
fi

print_success "Deployed $TARGET_APP_IMAGE"
```

---

### A.3 Shared helpers (`common.sh` — deploy section)

**File:** `scripts/lib/common.sh` (deploy-related functions — add to your shared helpers)

```bash
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose.prod.yml}"
ENV_FILE="${ENV_FILE:-.env.production}"

compose() {
  local args=()
  if [ -f "$PROJECT_ROOT/$ENV_FILE" ]; then
    args+=(--env-file "$PROJECT_ROOT/$ENV_FILE")
  fi
  docker compose "${args[@]}" "$@"
}

persist_app_image() {
  local image="$1"
  local env_default="$PROJECT_ROOT/.env"
  [ -n "$image" ] || return 0
  touch "$env_default"
  if grep -q '^APP_IMAGE=' "$env_default" 2>/dev/null; then
    sed -i "s|^APP_IMAGE=.*|APP_IMAGE=${image}|" "$env_default"
  else
    echo "APP_IMAGE=${image}" >> "$env_default"
  fi
}

read_persisted_app_image() {
  grep -E '^APP_IMAGE=' "$PROJECT_ROOT/.env" 2>/dev/null | head -n1 | cut -d= -f2- | tr -d '\r'
}

read_running_app_image() {
  docker inspect <your-app-container-name> --format '{{.Config.Image}}' 2>/dev/null | tr -d '\r' || true
}

read_last_good_app_image() {
  [ -f "$PROJECT_ROOT/.deploy-last-good-image" ] && head -n1 "$PROJECT_ROOT/.deploy-last-good-image" | tr -d '\r'
}

save_last_good_app_image() {
  [ -n "$1" ] && printf '%s\n' "$1" > "$PROJECT_ROOT/.deploy-last-good-image"
}

resolve_app_port() {
  load_env
  echo "${PORT:-8000}"
}

probe_app_http_health() {
  local port="${1:-$(resolve_app_port)}"
  local max_attempts="${2:-12}"
  local i
  for i in $(seq 1 "$max_attempts"); do
    if curl -fsS --max-time 5 "http://127.0.0.1:${port}/health" 2>/dev/null \
      | grep -qE '"success"[[:space:]]*:[[:space:]]*true|"up"[[:space:]]*:[[:space:]]*true'; then
      return 0
    fi
    sleep 5
  done
  return 1
}

rollback_app_deployment() {
  local rollback_image="$1"
  [ -n "$rollback_image" ] || return 1
  export APP_IMAGE="$rollback_image"
  compose -f "$COMPOSE_FILE" pull app 2>/dev/null || true
  compose -f "$COMPOSE_FILE" up -d --no-deps app
  if wait_for_healthy app 30 && probe_app_http_health "$(resolve_app_port)" 12; then
    compose -f "$COMPOSE_FILE" up -d --no-deps email-worker scheduler-worker
    persist_app_image "$rollback_image"
    save_last_good_app_image "$rollback_image"
    return 0
  fi
  return 1
}

wait_for_healthy() {
  local service="$1"
  local max_attempts="${2:-30}"
  local i
  for i in $(seq 1 "$max_attempts"); do
    if compose -f "$COMPOSE_FILE" ps "$service" 2>/dev/null | grep -q "(healthy)"; then
      return 0
    fi
    sleep 3
  done
  return 1
}
```

---

### A.4 Dockerfile

**File:** `Dockerfile`

```dockerfile
# syntax=docker/dockerfile:1.4

FROM oven/bun:1.3-alpine AS deps
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json bun.lock* ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --production --frozen-lockfile --no-progress

FROM oven/bun:1.3-alpine AS builder
WORKDIR /app
RUN apk add --no-cache python3 make g++
COPY package.json bun.lock* ./
COPY prisma ./prisma
RUN --mount=type=cache,target=/root/.bun/install/cache \
    bun install --frozen-lockfile --no-progress
COPY tsconfig.json ./
COPY src ./src
COPY scripts ./scripts
COPY serve.ts ./
RUN bun run build

FROM oven/bun:1.3-alpine AS runner
WORKDIR /app
RUN apk add --no-cache postgresql-client ca-certificates dumb-init
RUN addgroup -g 1001 -S nodejs && adduser -S nodejs -u 1001 -G nodejs

COPY --from=deps --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=deps --chown=nodejs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nodejs:nodejs /app/dist ./dist
COPY --from=builder --chown=nodejs:nodejs /app/scripts ./scripts
COPY --from=builder --chown=nodejs:nodejs /app/package.json ./
COPY docker/docker-entrypoint.sh /app/docker-entrypoint.sh
RUN chmod +x /app/docker-entrypoint.sh && chown nodejs:nodejs /app/docker-entrypoint.sh
RUN mkdir -p /app/storage/logs /app/storage/uploads && chown -R nodejs:nodejs /app/storage

USER nodejs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=90s --retries=3 \
  CMD bun run --bun /app/dist/src/healthcheck.js || exit 1

ENTRYPOINT ["dumb-init", "--", "/app/docker-entrypoint.sh"]
CMD ["bun", "run", "start"]
```

---

### A.5 Container entrypoint

**File:** `docker/docker-entrypoint.sh`

```sh
#!/bin/sh
set -e

if [ -z "$DATABASE_URL" ]; then
  echo "DATABASE_URL is not set"
  exit 1
fi

# Wait for Postgres
DB_HOST=$(echo "$DATABASE_URL" | sed -n 's/.*@\([^:]*\):.*/\1/p')
DB_PORT=$(echo "$DATABASE_URL" | sed -n 's/.*:\([0-9]*\)\/.*/\1/p')
DB_PORT="${DB_PORT:-5432}"

if command -v pg_isready > /dev/null 2>&1; then
  until pg_isready -h "$DB_HOST" -p "$DB_PORT" -q; do sleep 2; done
fi

# migrate deploy when migrations exist, else db push
MIGRATIONS_DIR="prisma/migrations"
if [ -d "$MIGRATIONS_DIR" ] && [ -n "$(ls -A "$MIGRATIONS_DIR" 2>/dev/null)" ]; then
  bunx prisma migrate deploy
else
  bunx prisma db push --skip-generate
fi

bunx prisma generate > /dev/null 2>&1 || true
exec "$@"
```

---

### A.6 Docker Compose (app + workers)

**File:** `docker-compose.prod.yml` (excerpt — app and workers)

```yaml
services:
  app:
    build:
      context: .
      dockerfile: Dockerfile
    image: ${APP_IMAGE:-<your-app>:latest}
    container_name: <your-app-container-name>
    restart: unless-stopped
    env_file:
      - .env.production
    environment:
      NODE_ENV: production
      PORT: ${PORT:-8000}
      DATABASE_URL: postgresql://${DB_USER:-postgres}:${DB_PASSWORD:?required}@db:5432/${DB_NAME:?required}?schema=public
      REDIS_URL: redis://redis:6379
    ports:
      - '127.0.0.1:${PORT:-8000}:${PORT:-8000}'
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    healthcheck:
      test: ['CMD', 'bun', 'run', '--bun', '/app/dist/src/healthcheck.js']
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 90s

  email-worker:
    image: ${APP_IMAGE:-<your-app>:latest}
    container_name: <your-app>-email-worker-prod
    restart: unless-stopped
    env_file:
      - .env.production
    depends_on:
      app:
        condition: service_healthy
    command: ['bun', '--bun', './dist/src/workers/email.worker.js']

  scheduler-worker:
    image: ${APP_IMAGE:-<your-app>:latest}
    container_name: <your-app>-scheduler-worker-prod
    restart: unless-stopped
    env_file:
      - .env.production
    depends_on:
      app:
        condition: service_healthy
    command: ['bun', '--bun', './dist/src/workers/scheduler.worker.js']
```

---

### A.7 Health endpoint + Docker healthcheck

**File:** `src/handlers/health.handler.ts`

```typescript
import { factory } from '@/lib/create-app'
import { ok } from '@/lib/response'
import dayjs from 'dayjs'

export const healthCheckHandler = factory.createHandlers((c) => {
  return c.json(
    ok(
      { up: true, ts: dayjs().toISOString() },
      `Server is healthy at ${dayjs().toISOString()}`,
    ),
  )
})
```

**File:** `src/routes/health.route.ts`

```typescript
import { healthCheckHandler } from '@/handlers/health.handler'
import { createRouter } from '@/lib/create-app'

const healthRoute = createRouter().get('/health', ...healthCheckHandler)
export default healthRoute
```

**File:** `src/healthcheck.ts` (used by Docker HEALTHCHECK)

```typescript
const port = Number(process.env.PORT) || 3000

const checkHealth = async () => {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 5000)

  const response = await fetch(`http://localhost:${port}/health`, {
    method: 'GET',
    signal: controller.signal,
  })

  clearTimeout(timeoutId)

  if (response.ok) {
    const data = (await response.json()) as {
      success?: boolean
      data?: { up?: boolean }
    }
    if (data.success === true || data.data?.up === true) {
      process.exit(0)
    }
  }
  process.exit(1)
}

checkHealth()
```

---

### A.8 CI test config (`vitest.config.ts`)

**File:** `vitest.config.ts`

```typescript
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  test: {
    environment: 'node',
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test?schema=public',
      JWT_SECRET: 'test-jwt-secret',
      JWT_REFRESH_SECRET: 'test-jwt-refresh-secret',
    },
  },
})
```

---

### A.9 `package.json` CI scripts

**File:** `package.json` (scripts section)

```json
{
  "scripts": {
    "build": "tsc && tsc-alias",
    "start": "bun run ./dist/serve.js",
    "lint": "eslint .",
    "test": "vitest run",
    "typecheck": "tsc --noEmit",
    "postinstall": "prisma generate",
    "db:migrate": "prisma migrate dev",
    "db:push": "prisma db push"
  }
}
```

---

### A.10 `.gitattributes`

**File:** `.gitattributes`

```gitattributes
* text=auto eol=lf
*.sh text eol=lf
*.png binary
*.jpg binary
*.webp binary
bun.lock binary
```

**Mark shell scripts executable in git index (run once):**

```bash
git ls-files '*.sh' | xargs -I {} git update-index --chmod=+x {}
git commit -m "chore: mark shell scripts executable"
```

---

### A.11 `.gitignore` entries

**File:** `.gitignore` (add these lines)

```gitignore
.env*
!.env.example
.backups/
.deploy-last-good-image
```

---

### A.12 Generate deploy SSH key

Run on your **local machine** (once per project):

```bash
ssh-keygen -t ed25519 -C "github-actions-deploy" -f deploy_key -N ""

# Public key → append to VPS ~/.ssh/authorized_keys for deploy user
cat deploy_key.pub

# Private key → GitHub secret DO_SSH_PRIVATE_KEY
# Or base64 (recommended on Windows):
base64 -w0 deploy_key   # Linux
# [Convert]::ToBase64String([IO.File]::ReadAllBytes("deploy_key"))  # PowerShell
# → GitHub secret DO_SSH_PRIVATE_KEY_B64
```

**GitHub secrets to create:**

| Secret | Value |
|---|---|
| `DO_HOST` | VPS IP or hostname |
| `DO_USERNAME` | SSH user (e.g. `deploy`) |
| `DO_SSH_PORT` | `22` |
| `DO_PROJECT_PATH` | `/home/deploy/my-app` |
| `DO_SSH_PRIVATE_KEY` or `DO_SSH_PRIVATE_KEY_B64` | Private deploy key |

---

## Related docs

- [../README.md](../README.md) — main project setup guide
- [MIGRATION_RECOVERY.md](./MIGRATION_RECOVERY.md) — fix failed Prisma migrations
- [docker/env.production.template](../docker/env.production.template) — production env variables

---

*Last updated: June 2026 — standalone reference with full source code in Appendix A. Export to PDF for offline use on future projects.*
