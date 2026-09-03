import 'dotenv/config'
import { parseJwtDuration } from '@/lib/jwt-duration'

function req(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`Missing env ${name}`)
  return v
}

export type StorageStrategy = 'local' | 'blob'

type StorageConfig =
  | { storageStrategy: 'local'; blobToken: string | undefined }
  | { storageStrategy: 'blob'; blobToken: string }

export function parseStorageStrategy(
  value: string | undefined,
  blobToken: string | undefined,
): StorageStrategy {
  const strategy = value?.trim() || 'local'

  if (strategy !== 'local' && strategy !== 'blob') {
    throw new Error(
      `Invalid STORAGE_STRATEGY "${strategy}". Expected "local" or "blob"`,
    )
  }

  if (strategy === 'blob' && !blobToken?.trim()) {
    throw new Error(
      'Missing env BLOB_READ_WRITE_TOKEN for STORAGE_STRATEGY "blob"',
    )
  }

  return strategy
}

const blobToken = process.env.BLOB_READ_WRITE_TOKEN || undefined
const storageStrategy = parseStorageStrategy(
  process.env.STORAGE_STRATEGY,
  blobToken,
)
const storageConfig: StorageConfig =
  storageStrategy === 'blob'
    ? { storageStrategy, blobToken: blobToken as string }
    : { storageStrategy, blobToken }

export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 3000),
  frontEndUrl: req('FRONT_END_URL', 'http://localhost:3000'),
  baseUrl: req('BASE_URL', `http://localhost:3000`),
  corsOrigins: (process.env.CORS_ORIGINS ?? '').split(',').filter(Boolean),
  logLevel: process.env.LOG_LEVEL ?? 'info',
  dbUrl: req('DATABASE_URL'),
  redisUrl: process.env.REDIS_URL,
  jwt: {
    secret: req('JWT_SECRET'),
    refreshSecret: req('JWT_REFRESH_SECRET'),
    issuer: req('JWT_ISSUER', 'century-padel-backend'),
    audience: req('JWT_AUDIENCE', 'century-padel-frontend'),
    expiresIn: parseJwtDuration(
      process.env.JWT_EXPIRES_IN ?? process.env.JWT_EXPIRES ?? '1m',
      'minute',
    ),
    refreshExpiresIn: parseJwtDuration(
      process.env.JWT_REFRESH_EXPIRES_IN ??
        process.env.JWT_REFRESH_EXPIRES ??
        '30d',
      'day',
    ),
  },
  xendit: {
    apiKey: process.env.XENDIT_API_KEY ?? '',
    callbackToken: process.env.XENDIT_CALLBACK_TOKEN ?? '',
  },
  paymentGatewayMode: process.env.PAYMENT_GATEWAY_MODE ?? 'xendit',
  webhookBaseUrl: req('WEBHOOK_BASE_URL', 'http://localhost:8787/webhooks'),
  ngrokToken: process.env.NGROK_AUTHTOKEN ?? '',
  fazpassGatewayKey: process.env.FAZPASS_GATEWAY_KEY ?? '',
  fazpassMerchantKey: process.env.FAZPASS_MERCHANT_KEY ?? '',
  fazpassApiUrl: process.env.FAZPASS_API_URL ?? 'https://api.fazpass.com/v1',
  pwdPepper: process.env.PWD_PEPPER ?? undefined,
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from: process.env.RESEND_FROM ?? 'Century Padel <onboarding@resend.dev>',
    backupAlertEmail:
      process.env.BACKUP_ALERT_EMAIL ?? 'ciptacodeteam@gmail.com',
  },
  smtp: {
    host: process.env.SMTP_HOST ?? 'smtp.mailtrap.io',
    port: parseInt(process.env.SMTP_PORT ?? '2525'),
    user: process.env.SMTP_USER ?? '',
    pass: process.env.SMTP_PASS ?? '',
    from: process.env.SMTP_FROM ?? 'noreply@centurypadel.id',
  },
  ...storageConfig,
}
