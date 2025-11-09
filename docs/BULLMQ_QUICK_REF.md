# BullMQ Quick Reference

## 🚀 Quick Start

### Development Environment

```bash
# 1. Install dependencies
bun install

# 2. Set up environment variables
cp .env.example .env.local

# 3. Start all services (including email worker)
docker-compose up

# 4. View email worker logs
docker-compose logs -f email-worker
```

## 📧 Email Queue API

### Queue Email

```typescript
import { queueEmail } from '@/services/email-queue.service'

await queueEmail({
  to: 'user@example.com',
  subject: 'Your Subject',
  template: 'passwordReset', // or 'verificationCode', 'welcome'
  variables: {
    /* template-specific */
  },
})
```

### Available Templates

| Template           | Variables                                     | Purpose              |
| ------------------ | --------------------------------------------- | -------------------- |
| `passwordReset`    | `name`, `resetLink`, `expiresIn`, `actionUrl` | Password reset email |
| `verificationCode` | `name`, `code`, `expiresIn`                   | OTP verification     |
| `welcome`          | `name`, `email`, `actionUrl`                  | Onboarding email     |

### Get Queue Stats

```typescript
import { getEmailQueueStats } from '@/services/email-queue.service'

const stats = await getEmailQueueStats()
// { active, completed, failed, waiting, delayed, isPaused }
```

## 🔐 Password Reset API

### 1. Request Reset (User-initiated)

**Endpoint:** `POST /auth/password-reset/request-reset`

```json
{
  "email": "user@example.com"
}
```

**Response:**

```json
{
  "success": true,
  "message": "If an account exists with this email, a reset link has been sent"
}
```

### 2. Verify Token

**Endpoint:** `GET /auth/password-reset/verify?token={token}`
**Response:**

```json
{
  "valid": true,
  "userId": "user123",
  "userName": "John Doe",
  "expiresAt": "2025-11-10T12:00:00Z"
}
```

### 3. Reset Password

**Endpoint:** `POST /auth/password-reset`

```json
{
  "token": "token...",
  "newPassword": "SecureP@ss123",
  "confirmPassword": "SecureP@ss123"
}
```

**Response:**

```json
{
  "success": true,
  "data": { "id": "user123", "email": "user@example.com", ... }
}
```

### 4. Admin-Triggered Reset

**Endpoint:** `POST /admin/users/{id}/send-reset-password`
**Response:**

```json
{
  "success": true,
  "data": {
    "channels": ["email"],
    "email": "user@example.com",
    "expiresAt": "2025-11-10T12:00:00Z"
  }
}
```

## 🗄️ Database Models

### PasswordResetToken

```prisma
{
  id: String (cuid)
  userId: String
  token: String (unique, 64 chars)
  expiresAt: DateTime (24h from creation)
  usedAt: DateTime? (null = unused)
  createdAt: DateTime
}
```

## 🐳 Docker Commands

```bash
# Start all services
docker-compose up

# Start specific service
docker-compose up postgres
docker-compose up redis
docker-compose up email-worker
docker-compose up app

# View logs
docker-compose logs -f email-worker
docker-compose logs -f app
docker-compose logs -f redis

# Stop services
docker-compose down

# Stop and remove volumes
docker-compose down -v

# Rebuild image
docker-compose build --no-cache
```

## 📊 Queue Configuration

| Setting     | Value               | Purpose                         |
| ----------- | ------------------- | ------------------------------- |
| Retries     | 3                   | Number of retry attempts        |
| Backoff     | Exponential         | 2s → 4s → 8s delays             |
| Concurrency | 5                   | Process 5 emails simultaneously |
| Storage     | Redis               | Persistent job storage          |
| Connection  | `REDIS_URL` env var | Redis connection string         |

## 🛠️ Environment Variables

### Required for Email Queue

```env
# Redis
REDIS_URL=redis://localhost:6379

# SMTP
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=username
SMTP_PASS=password
SMTP_FROM=noreply@quantumsport.com

# URLs
BASE_URL=http://localhost:3000
BASE_FRONTEND_URL=http://localhost:3001

# Password Security
PWD_PEPPER=your_pepper_string
```

## 📝 File Locations

| File                                          | Purpose                 |
| --------------------------------------------- | ----------------------- |
| `src/services/email-queue.service.ts`         | Queue management        |
| `src/services/email.service.ts`               | SMTP configuration      |
| `src/services/password-reset.service.ts`      | Token lifecycle         |
| `src/workers/email.worker.ts`                 | Worker process          |
| `src/handlers/auth/password-reset.handler.ts` | Endpoints               |
| `src/routes/password-reset.route.ts`          | Route definitions       |
| `prisma/schema.prisma`                        | Database schema         |
| `docker-compose.yml`                          | Container orchestration |

## 🐛 Debugging

### Check if worker is running

```bash
docker-compose ps
# EMAIL_WORKER should show 'Up'
```

### View worker logs

```bash
docker-compose logs email-worker --tail=50
```

### Test email sending manually

```typescript
import { queueEmail } from '@/services/email-queue.service'

await queueEmail({
  to: 'test@example.com',
  subject: 'Test Email',
  template: 'welcome',
  variables: { name: 'Test User' },
})
```

### Check Redis connection

```bash
docker-compose exec redis redis-cli ping
# Should respond: PONG
```

## ✅ Checklist

- [ ] `.env.local` configured with SMTP credentials
- [ ] Redis running (`REDIS_URL` accessible)
- [ ] Database migrated (`npx prisma migrate dev`)
- [ ] Email worker service running
- [ ] Routes loaded in `src/routes/password-reset.route.ts`
- [ ] TypeScript compiles without errors
- [ ] Docker services all healthy

## 📚 Full Documentation

See [BULLMQ_SETUP.md](./BULLMQ_SETUP.md) for comprehensive guide.

---

**Quick Tips:**

- 💡 Use `BASE_FRONTEND_URL` in reset link for user-facing URLs
- 💡 Test with [Mailtrap](https://mailtrap.io) email in development
- 💡 Monitor queue with admin dashboard (future enhancement)
- 💡 Failed jobs are kept in Redis for debugging
