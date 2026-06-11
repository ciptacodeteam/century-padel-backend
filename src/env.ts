import 'dotenv/config'

function req(name: string, fallback?: string) {
  const v = process.env[name] ?? fallback
  if (v === undefined) throw new Error(`Missing env ${name}`)
  return v
}

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
    expires: req('JWT_EXPIRES', '1'), // in minutes
    refreshExpires: req('JWT_REFRESH_EXPIRES', '30'), // in days
  },
  xendit: {
    apiKey: process.env.XENDIT_API_KEY ?? '',
    callbackToken: process.env.XENDIT_CALLBACK_TOKEN ?? '',
  },
  webhookBaseUrl: req('WEBHOOK_BASE_URL', 'http://localhost:8787/webhooks'),
  ngrokToken: process.env.NGROK_AUTHTOKEN ?? '',
  fazpassGatewayKey: process.env.FAZPASS_GATEWAY_KEY ?? '',
  fazpassMerchantKey: process.env.FAZPASS_MERCHANT_KEY ?? '',
  fazpassApiUrl: process.env.FAZPASS_API_URL ?? 'https://api.fazpass.com/v1',
  pwdPepper: process.env.PWD_PEPPER ?? undefined,
  blobToken: process.env.BLOB_READ_WRITE_TOKEN ?? undefined,
  resend: {
    apiKey: process.env.RESEND_API_KEY ?? '',
    from:
      process.env.RESEND_FROM ??
      'Century Padel <onboarding@resend.dev>',
    backupAlertEmail:
      process.env.BACKUP_ALERT_EMAIL ?? 'ciptacodeteam@gmail.com',
  },
  storageStrategy: process.env.STORAGE_STRATEGY || 'local', // 'local' or 'blob'
}
