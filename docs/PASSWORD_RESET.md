# Password Reset Implementation

This document outlines the password reset functionality with email and phone fallback support.

## Architecture

```
Admin Request → Create Reset Token → Queue Email
                                       ↓
                              Email Worker (Priority 1)
                              /           \
                      SUCCESS?           FAIL?
                         ↓                 ↓
                    Send Email      Send Phone OTP (Priority 2)
                         ↓                 ↓
                    Return Success    Return Success
```

## Features

✅ **Priority-based delivery**: Email first, phone as fallback
✅ **Verification checks**: Only verified contacts receive reset links
✅ **Token management**: Secure token generation and expiry tracking
✅ **Email queue**: Asynchronous email sending via BullMQ
✅ **Error handling**: Graceful fallback and comprehensive logging
✅ **Database tracking**: All reset tokens stored and indexed

## Components

### 1. Password Reset Service (`src/services/password-reset.service.ts`)

- **generatePasswordResetToken()**: Creates secure random token
- **createPasswordResetToken(userId)**: Stores token in DB with expiry
- **buildPasswordResetLink()**: Constructs reset link with token
- **verifyPasswordResetToken()**: Validates token (not expired, not used)
- **invalidatePasswordResetToken()**: Marks token as used
- **getValidPasswordResetToken()**: Retrieves valid token with user info

### 2. Admin Handler (`src/handlers/admin/user.handler.ts`)

**Endpoint**: `POST /admin/users/:id/send-reset-password`

**Request**:

```bash
POST /admin/users/user-id-123/send-reset-password
```

**Response** (Success):

```json
{
  "success": true,
  "data": {
    "userId": "user-id-123",
    "channels": ["email"],
    "message": "Password reset link sent successfully via email",
    "sentTo": {
      "email": "user@example.com",
      "phone": null
    },
    "expiresAt": "2024-11-09T10:30:00Z"
  },
  "message": "Reset password link sent via email"
}
```

### 3. Database Model

**Table**: `password_reset_token`

```prisma
model PasswordResetToken {
  id        String   @id @default(cuid())
  userId    String
  token     String   @unique
  expiresAt DateTime
  usedAt    DateTime?
  createdAt DateTime

  user User @relation(...)

  @@index([token])
  @@index([userId])
  @@index([expiresAt])
}
```

## Implementation Logic

### Step 1: Validate User

```typescript
const user = await db.user.findUnique({
  where: { id },
  select: {
    id: true,
    name: true,
    email: true,
    emailVerified: true,
    phone: true,
    phoneVerified: true,
  },
})

// Must have at least email or phone
if (!user.email && !user.phone) {
  throw new BadRequestException('User has no email or phone number')
}
```

### Step 2: Create Reset Token

```typescript
const { token, expiresIn, expiresAt } = await createPasswordResetToken(user.id)
const resetLink = buildPasswordResetLink(token, env.baseUrl)
```

### Step 3: Priority 1 - Send Email

```typescript
if (user.email && user.emailVerified) {
  try {
    await queueEmail({
      to: user.email,
      template: 'passwordReset',
      variables: {
        name: user.name,
        resetLink,
        expiresIn,
      },
    })
    channels.push('email')
  } catch (error) {
    // Fall through to phone
  }
}
```

### Step 4: Priority 2 - Send Phone OTP (Fallback)

```typescript
if (!channels.includes('email') && user.phone && user.phoneVerified) {
  try {
    const otp = generateOtp(6)
    const requestId = await sendPhoneOtp(user.phone, otp)
    if (requestId) {
      channels.push('phone')
    }
  } catch (error) {
    // Continue
  }
}
```

### Step 5: Return Result

```typescript
// Must have at least one channel
if (channels.length === 0) {
  throw new BadRequestException(
    'Unable to send password reset. Please ensure email/phone are verified.',
  )
}

return c.json(
  ok({
    userId: user.id,
    channels,
    message: `Password reset link sent via ${channels.join(' and ')}`,
    sentTo: { email, phone },
    expiresAt,
  }),
)
```

## Email Template

**Template**: `passwordReset`

```html
<h2>Password Reset Request</h2>
<p>Hi [name],</p>
<p>We received a request to reset your password.</p>
<p>
  <a href="[resetLink]" style="...">Reset Password</a>
</p>
<p>Link expires in [expiresIn].</p>
```

## Phone OTP Flow

When email is unavailable, system sends OTP via phone:

1. Generate 6-digit OTP
2. Send via Fazpass SMS service
3. User verifies on app/web
4. App creates new password

## Best Practices Implemented

### 🔐 Security

- Tokens are 64-character random hex strings
- Tokens have 24-hour expiry
- Tokens marked as used after consumption
- Database constraints prevent reuse

### 📧 Email Delivery

- Asynchronous via BullMQ queue
- 3 retry attempts with exponential backoff
- Templated HTML emails
- Tracking via logger

### 📱 Phone Fallback

- Only if email unavailable
- Only for verified contacts
- OTP via trusted Fazpass service
- Rate limiting handled by provider

### 📊 Monitoring

- All actions logged with context
- Queue statistics available
- Failed deliveries tracked
- Detailed error messages

### ⚡ Performance

- Indexes on token, userId, expiresAt
- Async operations don't block request
- Queue manages concurrency
- Redis caching for queue

### 🛡️ Validation

- User existence check
- Contact verification check
- Token expiry validation
- Single-use enforcement

## Testing

### Test Password Reset Flow

```bash
# 1. Send reset password link
curl -X POST http://localhost:3000/admin/users/user-id-123/send-reset-password

# 2. Check email queue
# Monitor via BullMQ board or Redis
redis-cli
KEYS email:*

# 3. Check worker logs
docker compose logs email-worker

# 4. Verify email was sent
# Check Mailtrap account for test emails
```

### Test with Different Scenarios

1. **User with verified email only**:
   - Email sent ✅
   - Phone skipped

2. **User with verified phone only**:
   - OTP sent via phone ✅

3. **User with both verified**:
   - Email sent ✅
   - Phone skipped (unless email fails)

4. **User with unverified contact**:
   - Returns error

5. **Queue failure**:
   - Falls back to phone ✅

## Troubleshooting

### Email Not Sending

1. Check Redis connection

   ```bash
   redis-cli ping
   ```

2. Check email worker running

   ```bash
   docker compose logs email-worker
   ```

3. Verify SMTP credentials in `.env.local`

4. Check queue stats
   ```typescript
   const stats = await getEmailQueueStats()
   ```

### Token Not Working

1. Check token in database

   ```sql
   SELECT * FROM password_reset_token WHERE token = 'xxx';
   ```

2. Verify not expired
3. Verify not already used

## Production Checklist

- [ ] Set `PASSWORD_RESET_EXPIRY` to 1 hour (currently 24)
- [ ] Implement rate limiting (max 3 resets per user per day)
- [ ] Setup email rate limiting with SMTP provider
- [ ] Enable token encryption in database (optional)
- [ ] Setup monitoring/alerting for failed deliveries
- [ ] Implement token rotation (invalidate old tokens on new request)
- [ ] Add audit logging for reset attempts
- [ ] Test with real email service (not Mailtrap)
- [ ] Setup email delivery tracking (opens, clicks)
- [ ] Implement password reset landing page

## Future Improvements

1. **Token rotation**: Invalidate old tokens when new one issued
2. **Rate limiting**: Prevent abuse (max 3 per day per user)
3. **Email verification**: Track opens/clicks
4. **SMS logging**: Track phone OTP delivery
5. **Backup codes**: Recovery codes for locked accounts
6. **Multi-factor auth**: SMS/email verification before password change
7. **Audit trail**: Track all password changes
8. **Notifications**: Alert user of password change
