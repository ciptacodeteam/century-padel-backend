import { getDefaultFromAddress, getResendClient } from '@/lib/resend'
import { log } from '@/lib/logger'

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

  paymentReceipt: (variables: Record<string, any>) => ({
    subject: `Payment Receipt - ${variables.invoiceNumber}`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin:0 auto;">
        <h2 style="color:#2c3e50;">Payment Successful</h2>
        <p>Hi ${variables.name},</p>
        <p>Thank you for your payment. Your transaction has been processed successfully.</p>
        <table style="width:100%; border-collapse:collapse; margin:20px 0;">
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Invoice Number</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600;">${variables.invoiceNumber}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Amount Paid</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600;">Rp ${variables.total.toLocaleString('id-ID')}</td>
          </tr>
          <tr>
            <td style="padding:8px; border:1px solid #eee;">Status</td>
            <td style="padding:8px; border:1px solid #eee; font-weight:600;">PAID</td>
          </tr>
        </table>
        <p>You can view the full invoice details in the app.</p>
        <p style="margin:25px 0;">
          <a href="${variables.invoiceUrl}" style="background:#16a34a; color:#fff; padding:12px 20px; text-decoration:none; border-radius:4px;">View Invoice</a>
        </p>
        <p style="font-size:12px; color:#666;">If you have questions reply to this email.</p>
        <hr style="margin-top:30px; border:none; border-top:1px solid #ddd;" />
        <p style="color:#999; font-size:11px; text-align:center;">Century Padel © 2025. All rights reserved.</p>
      </div>
    `,
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
