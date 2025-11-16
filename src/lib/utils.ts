export async function formatPhone(phone: string) {
  // Remove spaces, dashes, and parentheses
  const cleaned = phone.replace(/[\s\-()]/g, '')

  // Handle numbers starting with '+62'
  if (cleaned.startsWith('+62')) {
    return cleaned
  }

  // Handle numbers starting with '62'
  if (cleaned.startsWith('62')) {
    return `+${cleaned}`
  }

  // Handle numbers starting with '08'
  if (cleaned.startsWith('08')) {
    return `+62${cleaned.slice(1)}`
  }

  // Default: just add '+'
  if (!cleaned.startsWith('+')) {
    return `+${cleaned}`
  }

  return cleaned
}

export async function generateOtp(otpLength: number) {
  const min = Math.pow(10, otpLength - 1)
  const max = Math.pow(10, otpLength) - 1
  return (Math.floor(Math.random() * (max - min + 1)) + min).toString()
}

/**
 * Generate invoice number in format: INV-YYMMDD-XXXXXX
 * Example: INV-251116-A3K9FT
 */
export function generateInvoiceNumber(): string {
  const now = new Date()
  const year = now.getFullYear().toString().slice(-2)
  const month = (now.getMonth() + 1).toString().padStart(2, '0')
  const day = now.getDate().toString().padStart(2, '0')

  // Generate 6 random uppercase alphanumeric characters
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789'
  let randomStr = ''
  for (let i = 0; i < 6; i++) {
    randomStr += chars.charAt(Math.floor(Math.random() * chars.length))
  }

  return `INV-${year}${month}${day}-${randomStr}`
}
