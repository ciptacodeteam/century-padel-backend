# Email Queue Setup with BullMQ and Redis

This guide explains how to use the email queue system with BullMQ for asynchronous email sending.

## Architecture

```
API Request → Enqueue Email Job → Redis Queue
                                      ↓
                              Email Worker Process
                                      ↓
                              SMTP Service
                                      ↓
                              User Email
```

## Components

### 1. Email Queue Service (`src/services/email-queue.service.ts`)

- Manages BullMQ queue
- Handles job enqueueing with retries and backoff
- Provides queue statistics

### 2. Email Service (`src/services/email.service.ts`)

- SMTP transporter configuration
- Email templates (passwordReset, verificationCode, welcome)
- Direct email sending function
- Templated email sending

### 3. Email Worker (`src/workers/email.worker.ts`)

- Separate worker process that consumes queue jobs
- Processes emails asynchronously
- Handles graceful shutdown

## Setup

### Installation

Dependencies are already added to `package.json`:

- `bullmq` - Redis-based queue
- `nodemailer` - Email sending
- `ioredis` - Redis client
- `redis` - Redis connection

Install:

```bash
bun install
```

### Environment Variables

Add to `.env.local`:

```env
# Redis
REDIS_URL=redis://localhost:6379

# SMTP Configuration
SMTP_HOST=smtp.mailtrap.io
SMTP_PORT=2525
SMTP_USER=your_username
SMTP_PASS=your_password
SMTP_FROM=noreply@quantumsport.com
```

For production SMTP services:

- **Mailtrap**: https://mailtrap.io (testing)
- **SendGrid**: smtp.sendgrid.net
- **Gmail**: smtp.gmail.com (port 587)
- **AWS SES**: email-smtp.region.amazonaws.com

### Docker Setup

Using Docker Compose (already configured):

```bash
# Start services
docker compose -f docker-compose.yml up -d

# View logs
docker compose logs -f app
docker compose logs -f email-worker

# Stop services
docker compose down
```

The services running:

- **PostgreSQL**: localhost:5433
- **Redis**: localhost:6379
- **Prisma Studio**: http://localhost:5555
- **App API**: http://localhost:3000
- **Email Worker**: Background process

## Usage

### Enqueueing an Email Job

```typescript
import { queueEmail } from '@/services/email-queue.service'

// Queue a password reset email
await queueEmail({
  to: 'user@example.com',
  subject: 'Reset Password', // Used only for custom template
  template: 'passwordReset',
  variables: {
    name: 'John Doe',
    resetLink: 'https://app.com/reset?token=xxx',
    expiresIn: '1 hour',
  },
})
```

### Available Templates

#### 1. Password Reset

```typescript
template: 'passwordReset'
variables: {
  name: string
  resetLink: string
  expiresIn?: string
}
```

#### 2. Verification Code

```typescript
template: 'verificationCode'
variables: {
  name: string
  code: string
  expiresIn?: string
}
```

#### 3. Welcome Email

```typescript
template: 'welcome'
variables: {
  name: string
  appUrl: string
}
```

#### 4. Custom Template

```typescript
template: 'custom'
variables: {
  html: '<p>Your custom HTML</p>'
}
```

### Sending Direct Email (without queue)

```typescript
import { sendEmail, sendTemplatedEmail } from '@/services/email.service'

// Send custom email
await sendEmail('user@example.com', 'Subject', '<h1>HTML Content</h1>')

// Send templated email
await sendTemplatedEmail('user@example.com', 'passwordReset', {
  name: 'John',
  resetLink: '...',
  expiresIn: '1 hour',
})
```

## Running the Email Worker

### Development

```bash
bun run worker:email
```

### Docker (with profile)

```bash
# Run with worker
docker compose --profile workers up -d

# View worker logs
docker compose logs -f email-worker
```

### Production

In production, run as a separate service/pod:

```bash
bun run build
bun run ./dist/src/workers/email.worker.js
```

## Queue Monitoring

### Get Queue Stats

```typescript
import { getEmailQueueStats } from '@/services/email-queue.service'

const stats = await getEmailQueueStats()
console.log(stats)
// {
//   active: 0,
//   completed: 42,
//   failed: 1,
//   delayed: 0,
//   waiting: 5,
//   paused: false
// }
```

### Redis CLI Monitoring

```bash
# Connect to Redis
redis-cli

# Monitor email queue
MONITOR

# Or use BullMQ Board (UI tool)
npx @bull-board/cli --redis redis://localhost:6379
```

## Error Handling

### Retry Logic

Jobs automatically retry with exponential backoff:

- Attempt 1: Immediate
- Attempt 2: After 2 seconds
- Attempt 3: After 4 seconds

Failed jobs are stored in Redis for debugging.

### Custom Error Handling

Modify worker in `src/workers/email.worker.ts`:

```typescript
worker.on('failed', (job, err) => {
  // Custom error handling
  // Send alert to monitoring service
  // Log to external service
})
```

## Best Practices

1. **Always use templates**: Pre-built templates ensure consistent branding
2. **Test SMTP first**: Use Mailtrap for testing before production
3. **Monitor queue**: Check queue stats regularly
4. **Set up alerts**: Monitor failed jobs and queue backlog
5. **Use connection pooling**: Redis handles multiple connections efficiently
6. **Rate limiting**: Consider email rate limits from SMTP provider
7. **Graceful shutdown**: Worker handles SIGTERM/SIGINT for clean exits

## Troubleshooting

### Redis Connection Error

```
Error: connect ECONNREFUSED 127.0.0.1:6379
```

**Solution**: Start Redis container

```bash
docker compose up -d redis
```

### SMTP Authentication Failed

Check credentials in `.env.local` and test with:

```bash
redis-cli
# Test connection manually
```

### Worker Not Processing Jobs

1. Ensure Redis is running
2. Check worker logs: `docker compose logs email-worker`
3. Verify `REDIS_URL` environment variable
4. Make sure `bun run worker:email` is running

### Emails Not Being Sent

1. Check SMTP credentials in `.env.local`
2. Verify `SMTP_HOST` and `SMTP_PORT`
3. Check email templates for syntax errors
4. Review worker error logs

## Next Steps

- Implement password reset endpoint in admin controller
- Add email verification flow
- Create transactional email dashboard
- Setup email template versioning
- Add email delivery tracking
