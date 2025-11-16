# Docker Makefile for common operations

.PHONY: help build up down restart logs shell db-migrate db-backup clean

# Default target
help:
	@echo "Available commands:"
	@echo "  make prod-build    - Build production images"
	@echo "  make prod-up       - Start production services"
	@echo "  make prod-down     - Stop production services"
	@echo "  make prod-restart  - Restart production services"
	@echo "  make prod-logs     - View production logs"
	@echo "  make dev-up        - Start development services"
	@echo "  make dev-down      - Stop development services"
	@echo "  make logs          - View development logs"
	@echo "  make shell         - Access app container shell"
	@echo "  make db-migrate    - Run database migrations"
	@echo "  make db-backup     - Backup database"
	@echo "  make clean         - Clean up containers and volumes"

# Production commands
prod-build:
	docker-compose -f docker-compose.prod.yml build --no-cache

prod-up:
	docker-compose -f docker-compose.prod.yml up -d

prod-down:
	docker-compose -f docker-compose.prod.yml down

prod-restart:
	docker-compose -f docker-compose.prod.yml restart

prod-logs:
	docker-compose -f docker-compose.prod.yml logs -f

prod-shell:
	docker-compose -f docker-compose.prod.yml exec app sh

# Development commands
dev-up:
	docker-compose up -d

dev-down:
	docker-compose down

dev-logs:
	docker-compose logs -f

dev-shell:
	docker-compose exec app sh

# Database commands
db-migrate:
	docker-compose -f docker-compose.prod.yml exec app bunx prisma migrate deploy

db-backup:
	docker-compose -f docker-compose.prod.yml exec db pg_dump -U postgres quantum_sport > backup_$$(date +%Y%m%d_%H%M%S).sql

db-restore:
	@echo "Usage: make db-restore FILE=backup.sql"
	docker-compose -f docker-compose.prod.yml exec -T db psql -U postgres quantum_sport < $(FILE)

# Cleanup commands
clean:
	docker-compose -f docker-compose.prod.yml down -v
	docker system prune -f

clean-all:
	docker-compose down -v
	docker-compose -f docker-compose.prod.yml down -v
	docker system prune -af --volumes
