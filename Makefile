# Docker shortcuts — for full deploy/update use scripts/ instead.

.PHONY: help dev-up dev-down dev-logs prod-status prod-logs prod-shell db-migrate db-backup clean

help:
	@echo "Development:"
	@echo "  make dev-up        Start dev stack"
	@echo "  make dev-down      Stop dev stack"
	@echo "  make dev-logs      Tail dev logs"
	@echo ""
	@echo "Production (shortcuts):"
	@echo "  make prod-status   Show container status"
	@echo "  make prod-logs     Tail production logs"
	@echo "  make prod-shell    Shell into app container"
	@echo ""
	@echo "Deploy scripts (preferred):"
	@echo "  ./scripts/install-vps.sh    Fresh VPS setup (once)"
	@echo "  ./scripts/deploy-fresh.sh   First production deploy"
	@echo "  ./scripts/update.sh         Routine code updates"
	@echo ""
	@echo "Database:"
	@echo "  make db-migrate    Run migrations in prod app"
	@echo "  make db-backup     Backup production database"

dev-up:
	docker compose up -d

dev-down:
	docker compose down

dev-logs:
	docker compose logs -f

prod-status:
	docker compose -f docker-compose.prod.yml ps

prod-logs:
	docker compose -f docker-compose.prod.yml logs -f app

prod-shell:
	docker compose -f docker-compose.prod.yml exec app sh

db-migrate:
	docker compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

db-backup:
	docker compose -f docker-compose.prod.yml exec db pg_dump -U postgres -Fc century_padel > backup_$$(date +%Y%m%d).dump

clean:
	docker compose down -v

clean-all:
	docker compose -f docker-compose.prod.yml down -v
	docker system prune -af
