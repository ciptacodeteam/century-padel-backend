import { Resend } from 'resend'
import { env } from '@/env'

let client: Resend | null = null

export const getResendClient = (): Resend => {
  if (!env.resend.apiKey) {
    throw new Error('RESEND_API_KEY is required for email delivery')
  }

  client ??= new Resend(env.resend.apiKey)
  return client
}

export const getDefaultFromAddress = (): string => env.resend.from
