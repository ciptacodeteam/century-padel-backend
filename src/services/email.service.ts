import { JAKARTA_TZ } from '@/config'
import { env } from '@/env'
import { log } from '@/lib/logger'
import { db } from '@/lib/prisma'
import { calculateCourtHours } from '@/services/membership-hours.service'
import { Role } from '@prisma/client'
import { getDefaultFromAddress, getResendClient } from '@/lib/resend'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'
import 'dayjs/locale/id.js'

dayjs.extend(utc)
dayjs.extend(timezone)

type EmailLineItem = {
  title: string
  startAt: string
  endAt: string
  amount: number
  coveredByMembership?: boolean
}

type MembershipUsage = {
  name: string
  sessionsUsed: number
  remainingSessions: number
}

const escapeHtml = (value: unknown) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

const formatRp = (amount: number) =>
  `Rp ${Number(amount || 0).toLocaleString('id-ID')}`

const formatWhen = (value: string | Date | null | undefined, pattern: string) => {
  if (!value) return ''
  const parsed = dayjs(value)
  if (!parsed.isValid()) return ''
  return parsed.tz(JAKARTA_TZ).locale('id').format(pattern)
}

// Court slots are stored as Jakarta wall-clock values with a UTC label
// (19:00 WIB is 19:00Z). Convert those with `.tz('Asia/Jakarta')` and the
// email shows 02:00 the next day. Payment timestamps are real UTC instants.
const formatSlotWhen = (
  value: string | Date | null | undefined,
  pattern: string,
) => {
  if (!value) return ''
  const parsed = dayjs.utc(value)
  if (!parsed.isValid()) return ''
  return parsed.locale('id').format(pattern)
}

const bannerSrc = () =>
  `${env.frontEndUrl.replace(/\/$/, '')}/email/century-padel-banner.png`

const emailShell = (body: string) => `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#f4f4f5;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;">
    <tr>
      <td align="center" style="padding:24px 12px;">
        <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;background:#ffffff;">
          <tr>
            <td style="padding:0;line-height:0;font-size:0;">
              <img src="${bannerSrc()}" alt="Century Padel" width="600" style="display:block;width:100%;max-width:600px;height:auto;border:0;" />
            </td>
          </tr>
          <tr>
            <td style="padding:28px 28px 36px;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;color:#111111;">
              ${body}
              <p style="margin:28px 0 0;color:#a1a1aa;font-size:11px;line-height:1.5;text-align:center;">
                Century Padel Medan<br />This is an automated message.
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`

const emailButton = (label: string, href: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;">
    <tr>
      <td align="center" bgcolor="#e35336" style="background:#e35336;border-radius:12px;">
        <a href="${escapeHtml(href)}" style="display:block;padding:14px 18px;font-family:'Plus Jakarta Sans',Arial,Helvetica,sans-serif;font-size:14px;font-weight:700;color:#ffffff;text-decoration:none;">${escapeHtml(label)}</a>
      </td>
    </tr>
  </table>`

const detailCard = (headHtml: string, bodyHtml: string) => `
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:22px;border:1px solid #ececee;border-radius:16px;">
    <tr>
      <td style="background:#fafafa;padding:16px 18px;border-bottom:1px solid #ececee;">${headHtml}</td>
    </tr>
    <tr>
      <td style="padding:16px 18px 8px;">${bodyHtml}</td>
    </tr>
  </table>`

const lineItemsHtml = (items: EmailLineItem[], statusLabel?: string) =>
  items
    .map((item) => {
      const time = `${formatSlotWhen(item.startAt, 'HH:mm')} – ${formatSlotWhen(item.endAt, 'HH:mm')}`
      const date = formatSlotWhen(item.startAt, 'dddd, D MMM YYYY')
      const trailing = statusLabel
        ? `<td align="right" valign="top" style="font-size:13px;font-weight:700;color:#e35336;white-space:nowrap;">${escapeHtml(statusLabel)}</td>`
        : item.coveredByMembership
          ? `<td align="right" valign="top" style="font-size:13px;font-weight:700;color:#111111;white-space:nowrap;">Membership</td>`
          : `<td align="right" valign="top" style="font-size:14px;font-weight:700;white-space:nowrap;">${formatRp(item.amount)}</td>`
      return `<tr>
        <td style="padding-bottom:16px;">
          <div style="font-size:15px;font-weight:700;">${escapeHtml(item.title)}</div>
          <div style="margin-top:4px;font-size:13px;color:#71717a;">${escapeHtml(time)}</div>
          <div style="margin-top:2px;font-size:13px;color:#71717a;">${escapeHtml(date)}</div>
        </td>
        ${trailing}
      </tr>`
    })
    .join('')

const costRows = (
  rows: Array<{ label: string; amount: number; emphasize?: boolean; deduct?: boolean }>,
) =>
  rows
    .map((row, index) => {
      const border = row.emphasize
        ? 'border-top:1px dashed #d4d4d8;'
        : index === 0
          ? 'border-top:1px solid #ececee;'
          : ''
      const amountStyle = row.emphasize
        ? 'font-weight:700;color:#e35336;'
        : 'font-weight:600;'
      const amount = row.deduct ? `− ${formatRp(row.amount)}` : formatRp(row.amount)
      return `<tr>
        <td style="padding:10px 0;font-size:14px;${border}${row.emphasize ? 'font-weight:700;' : ''}">${escapeHtml(row.label)}</td>
        <td align="right" style="padding:10px 0;font-size:14px;${border}${amountStyle}">${amount}</td>
      </tr>`
    })
    .join('')

const asLineItems = (value: unknown): EmailLineItem[] =>
  Array.isArray(value) ? (value as EmailLineItem[]) : []

const asMembershipUsage = (value: unknown): MembershipUsage[] =>
  Array.isArray(value) ? (value as MembershipUsage[]) : []

const membershipSummary = (usages: MembershipUsage[]) => {
  if (usages.length === 0) return ''

  const blocks = usages
    .map(
      (usage) => `<div style="padding:12px 0 4px;border-top:1px solid #ececee;">
        <div style="font-size:14px;font-weight:700;">${escapeHtml(usage.name)}</div>
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:8px;font-size:14px;">
          <tr>
            <td style="padding:4px 0;color:#71717a;">Sessions used</td>
            <td align="right" style="padding:4px 0;font-weight:700;">${Number(usage.sessionsUsed) || 0}</td>
          </tr>
          <tr>
            <td style="padding:4px 0;color:#71717a;">Remaining sessions</td>
            <td align="right" style="padding:4px 0;font-weight:700;color:#e35336;">${Number(usage.remainingSessions) || 0}</td>
          </tr>
        </table>
      </div>`,
    )
    .join('')

  return `<div style="font-size:15px;font-weight:700;padding:8px 0 4px;">Membership</div>${blocks}`
}

/**
 * Email templates
 */
export const emailTemplates = {
  passwordReset: (variables: Record<string, any>) => ({
    subject: 'Reset Your Password',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Request</h2>
        <p>Hi ${variables.name},</p>
        <p>We received a request to reset your password. Click the link below to proceed:</p>
        <p style="margin: 30px 0;">
          <a href="${variables.resetLink}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Reset Password
          </a>
        </p>
        <p style="color: #666; font-size: 12px;">
          This link will expire in ${variables.expiresIn || '1 hour'}.
          <br />
          If you didn't request this, you can ignore this email.
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
        <p style="color: #999; font-size: 11px; text-align: center;">
          Century Padel © 2024. All rights reserved.
        </p>
      </div>
    `,
  }),

  passwordResetSuccess: (variables: Record<string, any>) => ({
    subject: 'Password Reset Successfully',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Password Reset Successfully</h2>
        <p>Hi ${variables.name},</p>
        <p>Your password has been reset successfully.</p>
        <p>You can now login to your account using your new password.</p>
        <p>Thank you for using Century Padel.</p>
      </div>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
        <p style="color: #999; font-size: 11px; text-align: center;">
          Century Padel © 2024. All rights reserved.
        </p>
      </div>
    `,
  }),

  welcome: (variables: Record<string, any>) => ({
    subject: 'Welcome to Century Padel!',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Century Padel!</h2>
        <p>Hi ${variables.name},</p>
        <p>Thank you for joining Century Padel. We're excited to have you on board.</p>
        <p>You can now:</p>
        <ul>
          <li>Book courts and sessions</li>
          <li>Join clubs and tournaments</li>
          <li>Connect with other sports enthusiasts</li>
        </ul>
        <p style="margin: 30px 0;">
          <a href="${variables.appUrl}" style="background-color: #007bff; color: white; padding: 12px 24px; text-decoration: none; border-radius: 4px; display: inline-block;">
            Get Started
          </a>
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
        <p style="color: #999; font-size: 11px; text-align: center;">
          Century Padel © 2024. All rights reserved.
        </p>
      </div>
    `,
  }),

  bookingConfirmation: (variables: Record<string, any>) => {
    const items = asLineItems(variables.items)
    const memberships = asMembershipUsage(variables.memberships)
    const courtLabel = items[0]?.title || 'Court'
    return {
      subject: `Booking Confirmed — ${courtLabel}`,
      html: emailShell(`
        <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">Welcome ${escapeHtml(variables.name)},</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">Your court booking is confirmed. We're excited to see you soon.</p>
        ${detailCard(
          `<div style="font-size:14px;font-weight:700;">Booking ID: #${escapeHtml(variables.invoiceNumber)}</div>`,
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineItemsHtml(items)}</table>
           ${membershipSummary(memberships)}
           <div style="font-size:15px;font-weight:700;padding:8px 0 12px;">Rincian Biaya</div>
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${costRows([
             { label: 'Total', amount: Number(variables.total || 0), emphasize: true },
           ])}</table>`,
        )}
        ${emailButton('Lihat Booking', variables.invoiceUrl)}
      `),
    }
  },

  paymentReceipt: (variables: Record<string, any>) => {
    const items = asLineItems(variables.items)
    const memberships = asMembershipUsage(variables.memberships)
    const rows: Array<{
      label: string
      amount: number
      emphasize?: boolean
      deduct?: boolean
    }> = [
      { label: 'Subtotal', amount: Number(variables.subtotal || 0) },
    ]
    if (Number(variables.processingFee) > 0) {
      rows.push({
        label: 'Biaya layanan',
        amount: Number(variables.processingFee),
      })
    }
    if (Number(variables.promoDiscountAmount) > 0) {
      rows.push({
        label: 'Promo',
        amount: Number(variables.promoDiscountAmount),
        deduct: true,
      })
    }
    rows.push({
      label: 'Total Pembayaran',
      amount: Number(variables.total || 0),
      emphasize: true,
    })
    const paidAtLabel = formatWhen(
      variables.paidAt,
      'dddd, D MMM YYYY · HH:mm',
    )

    const intro = items.length
      ? "Your payment has been successfully processed and your booking is confirmed. We're excited to see you soon."
      : 'Your payment has been successfully processed.'

    return {
      subject: `Payment Receipt - ${variables.invoiceNumber}`,
      html: emailShell(`
        <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">Welcome ${escapeHtml(variables.name)},</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">${intro}</p>
        ${detailCard(
          `<div style="font-size:14px;font-weight:700;">Order ID: #${escapeHtml(variables.invoiceNumber)}</div>
           ${paidAtLabel ? `<div style="margin-top:4px;font-size:13px;color:#71717a;">Payment Time: ${escapeHtml(paidAtLabel)}</div>` : ''}`,
          `${items.length ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineItemsHtml(items)}</table>` : ''}
           ${membershipSummary(memberships)}
           <div style="font-size:15px;font-weight:700;padding:8px 0 12px;">Rincian Biaya</div>
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${costRows(rows)}</table>`,
        )}
        ${emailButton('Lihat Invoice', variables.invoiceUrl)}
      `),
    }
  },

  bookingCancelled: (variables: Record<string, any>) => {
    const items = asLineItems(variables.items)
    const courtLabel = items[0]?.title || 'Booking'
    const cancelledAtLabel = formatWhen(
      variables.cancelledAt,
      'dddd, D MMM YYYY · HH:mm',
    )
    return {
      subject: `Booking Cancelled — ${courtLabel}`,
      html: emailShell(`
        <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">Hi ${escapeHtml(variables.name)},</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">An admin cancelled this booking. The court time has been released.</p>
        ${detailCard(
          `<div style="font-size:14px;font-weight:700;">Booking ID: #${escapeHtml(variables.invoiceNumber || '')}</div>
           ${cancelledAtLabel ? `<div style="margin-top:4px;font-size:13px;color:#71717a;">Cancelled: ${escapeHtml(cancelledAtLabel)}</div>` : ''}`,
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineItemsHtml(items, 'Dibatalkan')}</table>
           <div style="font-size:13px;color:#71717a;padding-top:4px;">Alasan</div>
           <div style="font-size:14px;font-weight:600;padding:4px 0 14px;">${escapeHtml(variables.reason || 'Dibatalkan oleh admin')}</div>
           <p style="margin:0 0 8px;font-size:13px;line-height:1.55;color:#71717a;">If this booking was already paid, our team will contact you about the refund.</p>`,
        )}
        ${variables.invoiceUrl ? emailButton('Lihat Detail', variables.invoiceUrl) : ''}
      `),
    }
  },

  adminCourtBooking: (variables: Record<string, any>) => {
    const items = asLineItems(variables.items)
    const memberships = asMembershipUsage(variables.memberships)
    const courtLabel = items[0]?.title || 'Court'
    return {
      subject: `New court booking — ${courtLabel}`,
      html: emailShell(`
        <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">New court booking</p>
        <p style="margin:0;font-size:15px;line-height:1.6;">A customer just booked a court.</p>
        ${detailCard(
          `<div style="font-size:14px;font-weight:700;">${escapeHtml(variables.customerName || 'Customer')}</div>
           <div style="margin-top:4px;font-size:13px;color:#71717a;">${escapeHtml(variables.customerEmail || '')}${variables.customerPhone ? ` · ${escapeHtml(variables.customerPhone)}` : ''}</div>
           <div style="margin-top:4px;font-size:13px;color:#71717a;">Invoice #${escapeHtml(variables.invoiceNumber)}</div>`,
          `<table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lineItemsHtml(items)}</table>
           ${membershipSummary(memberships)}
           <div style="font-size:15px;font-weight:700;padding:8px 0 12px;">Rincian Biaya</div>
           <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${costRows([
             { label: 'Total', amount: Number(variables.total || 0), emphasize: true },
           ])}</table>`,
        )}
        ${emailButton('Open bookings', variables.adminUrl)}
      `),
    }
  },

  adminMembershipPurchase: (variables: Record<string, any>) => ({
    subject: `New membership — ${variables.membershipName || 'Membership'}`,
    html: emailShell(`
      <p style="margin:0 0 14px;font-size:16px;line-height:1.5;">New membership purchase</p>
      <p style="margin:0;font-size:15px;line-height:1.6;">A customer just bought a membership.</p>
      ${detailCard(
        `<div style="font-size:14px;font-weight:700;">${escapeHtml(variables.customerName || 'Customer')}</div>
         <div style="margin-top:4px;font-size:13px;color:#71717a;">${escapeHtml(variables.customerEmail || '')}${variables.customerPhone ? ` · ${escapeHtml(variables.customerPhone)}` : ''}</div>
         <div style="margin-top:4px;font-size:13px;color:#71717a;">Invoice #${escapeHtml(variables.invoiceNumber)}</div>`,
        `<div style="font-size:15px;font-weight:700;padding-bottom:8px;">${escapeHtml(variables.membershipName || 'Membership')}</div>
         <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14px;">
           <tr>
             <td style="padding:8px 0;color:#71717a;border-top:1px solid #ececee;">Sessions included</td>
             <td align="right" style="padding:8px 0;font-weight:700;border-top:1px solid #ececee;">${Number(variables.sessions) || 0}</td>
           </tr>
           <tr>
             <td style="padding:12px 0 8px;border-top:1px dashed #d4d4d8;font-weight:700;">Total</td>
             <td align="right" style="padding:12px 0 8px;border-top:1px dashed #d4d4d8;font-weight:700;color:#e35336;">${formatRp(Number(variables.total || 0))}</td>
           </tr>
         </table>`,
      )}
      ${emailButton('Open memberships', variables.adminUrl)}
    `),
  }),

  emailVerification: (variables: Record<string, any>) => ({
    subject: 'Verify Your Email Address',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Email Verification</h2>
        <p>Hi ${variables.name},</p>
        <p>You requested to ${variables.action} to this email.</p>
        <p>Please use the following OTP code to verify:</p>
        <div style="background-color: #f4f4f4; padding: 20px; text-align: center; margin: 20px 0;">
          <h1 style="margin: 0; letter-spacing: 8px; color: #007bff;">${variables.code}</h1>
        </div>
        <p style="color: #666; font-size: 12px;">
          This code will expire in 10 minutes.
          <br />
          If you didn't request this, please ignore this email.
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
        <p style="color: #999; font-size: 11px; text-align: center;">
          Century Padel © 2025. All rights reserved.
        </p>
      </div>
    `,
  }),

  emailChangeAlert: (variables: Record<string, any>) => ({
    subject: 'Email Change Request Alert',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Email Change Request</h2>
        <p>Hi ${variables.name},</p>
        <p>We received a request to change your email address from <strong>${variables.oldEmail}</strong> to <strong>${variables.newEmail}</strong>.</p>
        <p>If you made this request, you can safely ignore this email. The change will be completed once the new email is verified.</p>
        <div style="background-color: #fff3cd; border-left: 4px solid #ffc107; padding: 15px; margin: 20px 0;">
          <p style="margin: 0; color: #856404;">
            <strong>⚠️ Security Alert:</strong> If you did NOT request this change, please secure your account immediately by changing your password.
          </p>
        </div>
        <p style="color: #666; font-size: 12px;">
          This is an automated security notification.
        </p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
        <p style="color: #999; font-size: 11px; text-align: center;">
          Century Padel © 2025. All rights reserved.
        </p>
      </div>
    `,
  }),

  emailChangeSuccess: (variables: Record<string, any>) => ({
    subject: variables.title,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${variables.title}</h2>
        <p>Hi ${variables.name},</p>
        <p>Your email address has been successfully ${variables.action} to <strong>${variables.email}</strong>.</p>
        <p>You can now use this email address to receive notifications and updates from Century Padel.</p>
        <hr style="margin-top: 30px; border: none; border-top: 1px solid #ddd;" />
        <p style="color: #999; font-size: 11px; text-align: center;">
          Century Padel © 2025. All rights reserved.
        </p>
      </div>
    `,
  }),

  backupFailure: (variables: Record<string, any>) => ({
    subject: `[Century Padel] Database backup failed — ${variables.host}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2 style="color: #dc2626;">Database Backup Failed</h2>
        <p>The scheduled PostgreSQL backup did not complete successfully.</p>
        <table style="width:100%; border-collapse:collapse; margin:20px 0;">
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Server</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600;">${variables.host}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Database</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600;">${variables.database}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Time (UTC)</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600;">${variables.timestamp}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Error</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600; color:#dc2626;">${variables.error}</td>
          </tr>
        </table>
        <p style="font-size:12px; color:#666;">Check backup logs on the VPS: <code>/var/log/century-padel-backup.log</code></p>
        <hr style="margin-top:30px; border:none; border-top:1px solid #ddd;" />
        <p style="color:#999; font-size:11px; text-align:center;">Century Padel automated backup alert</p>
      </div>
    `,
  }),
}

export type EmailTemplate = keyof typeof emailTemplates

/**
 * Send email via Resend
 */
export const sendEmail = async (
  to: string,
  subject: string,
  html: string,
  from?: string,
) => {
  const { data, error } = await getResendClient().emails.send({
    from: from ?? getDefaultFromAddress(),
    to: [to],
    subject,
    html,
  })

  if (error) {
    log.error({ to, error: error.message, name: error.name }, 'Failed to send email')
    throw new Error(error.message)
  }

  log.info({ messageId: data?.id, to }, 'Email sent successfully')
  return data
}

/**
 * Send templated email
 */
export const sendTemplatedEmail = async (
  to: string,
  template: EmailTemplate,
  variables: Record<string, any>,
  from?: string,
) => {
  const templateFn = emailTemplates[template]
  if (!templateFn) {
    throw new Error(`Email template '${template}' not found`)
  }

  const { subject, html } = templateFn(variables)
  return sendEmail(to, subject, html, from)
}

type PaidInvoiceEmailInput = {
  email: string | null
  name: string | null
  invoiceNumber: string
  subtotal: number
  processingFee: number
  promoDiscountAmount: number
  total: number
  paidAt?: Date | null
  bookingId?: string | null
}

export const queuePaidInvoiceEmails = async (invoice: PaidInvoiceEmailInput) => {
  const invoiceUrl = `${env.frontEndUrl.replace(/\/$/, '')}/invoice/${invoice.invoiceNumber}`
  const items = invoice.bookingId
    ? await loadBookingEmailItems(invoice.bookingId)
    : []
  const memberships = invoice.bookingId
    ? await loadMembershipUsage(invoice.bookingId)
    : []

  if (invoice.email) {
    const recipient = await db.user.findFirst({
      where: { email: { equals: invoice.email, mode: 'insensitive' } },
      select: { emailVerified: true },
    })
    if (!recipient?.emailVerified) {
      log.info(
        { email: invoice.email, invoiceNumber: invoice.invoiceNumber },
        'Skipping customer email because the address is not verified',
      )
    } else {
      await queueSendTemplatedEmail(invoice.email, 'paymentReceipt', {
        name: invoice.name || 'there',
        invoiceNumber: invoice.invoiceNumber,
        subtotal: invoice.subtotal,
        processingFee: invoice.processingFee,
        promoDiscountAmount: invoice.promoDiscountAmount,
        total: invoice.total,
        paidAt: invoice.paidAt?.toISOString(),
        invoiceUrl,
        items,
        memberships,
      })

      if (items.length > 0) {
        await queueSendTemplatedEmail(invoice.email, 'bookingConfirmation', {
          name: invoice.name || 'there',
          invoiceNumber: invoice.invoiceNumber,
          total: invoice.total,
          invoiceUrl,
          items,
          memberships,
        })
      }
    }
  }

  await queueSuperadminInvoiceEmails(invoice.invoiceNumber)
}

export const queueSuperadminInvoiceEmails = async (invoiceNumber: string) => {
  const record = await db.invoice.findUnique({
    where: { number: invoiceNumber },
    select: {
      number: true,
      total: true,
      bookingId: true,
      user: { select: { name: true, email: true, phone: true } },
      membershipUser: {
        select: { membership: { select: { name: true, sessions: true } } },
      },
    },
  })
  if (!record) return

  const adminBase = env.frontEndUrl.replace(/\/$/, '')
  const customer = record.user

  if (record.bookingId) {
    const items = await loadBookingEmailItems(record.bookingId)
    if (items.length === 0) return
    const memberships = await loadMembershipUsage(record.bookingId)
    await queueSuperadminEmails('adminCourtBooking', {
      customerName: customer?.name,
      customerEmail: customer?.email,
      customerPhone: customer?.phone,
      invoiceNumber: record.number,
      total: record.total,
      items,
      memberships,
      adminUrl: `${adminBase}/admin/kelola-pemesanan/lapangan`,
    })
    return
  }

  const membership = record.membershipUser?.membership
  if (!membership) return

  await queueSuperadminEmails('adminMembershipPurchase', {
    customerName: customer?.name,
    customerEmail: customer?.email,
    customerPhone: customer?.phone,
    invoiceNumber: record.number,
    membershipName: membership.name,
    sessions: membership.sessions,
    total: record.total,
    adminUrl: `${adminBase}/admin/kelola-pemesanan/membership`,
  })
}

const queueSuperadminEmails = async (
  template: 'adminCourtBooking' | 'adminMembershipPurchase',
  variables: Record<string, any>,
) => {
  const admins = await db.staff.findMany({
    where: { role: Role.ADMIN, isActive: true },
    select: { email: true },
  })

  await Promise.all(
    admins.map((admin) =>
      queueSendTemplatedEmail(admin.email, template, variables),
    ),
  )
}

const loadBookingEmailItems = async (bookingId: string): Promise<EmailLineItem[]> => {
  const details = await db.bookingDetail.findMany({
    where: { bookingId },
    include: {
      court: { select: { name: true } },
      slot: { select: { startAt: true, endAt: true } },
    },
    orderBy: { slot: { startAt: 'asc' } },
  })

  return details.map((detail) => ({
    title: detail.court?.name || 'Court',
    startAt: detail.slot.startAt.toISOString(),
    endAt: detail.slot.endAt.toISOString(),
    amount: detail.membershipUserId ? 0 : detail.discountPrice,
    coveredByMembership: Boolean(detail.membershipUserId),
  }))
}

const loadMembershipUsage = async (
  bookingId: string,
): Promise<MembershipUsage[]> => {
  const details = await db.bookingDetail.findMany({
    where: { bookingId, membershipUserId: { not: null } },
    include: {
      slot: { select: { startAt: true, endAt: true } },
      membershipUser: {
        include: { membership: { select: { name: true } } },
      },
    },
  })

  const grouped = new Map<
    string,
    {
      name: string
      remainingSessions: number
      slots: Array<{ startAt: Date; endAt: Date }>
    }
  >()

  for (const detail of details) {
    if (!detail.membershipUserId || !detail.membershipUser) continue
    const current = grouped.get(detail.membershipUserId) ?? {
      name: detail.membershipUser.membership.name,
      remainingSessions: detail.membershipUser.remainingSessions,
      slots: [] as Array<{ startAt: Date; endAt: Date }>,
    }
    current.slots.push({
      startAt: detail.slot.startAt,
      endAt: detail.slot.endAt,
    })
    grouped.set(detail.membershipUserId, current)
  }

  return [...grouped.values()].map((usage) => ({
    name: usage.name,
    sessionsUsed: calculateCourtHours(usage.slots),
    remainingSessions: usage.remainingSessions,
  }))
}

/**
 * Queue templated email (non-blocking)
 */
export const queueSendTemplatedEmail = async (
  to: string,
  template: EmailTemplate,
  variables: Record<string, any>,
) => {
  const { queueEmail } = await import('@/services/email-queue.service')

  return queueEmail({
    to,
    subject: '',
    template,
    variables,
  })
}

/**
 * Queue custom email (non-blocking)
 */
export const queueCustomEmail = async (
  to: string,
  subject: string,
  html: string,
) => {
  const { queueEmail } = await import('@/services/email-queue.service')

  return queueEmail({
    to,
    subject,
    template: 'custom',
    variables: { html },
  })
}
