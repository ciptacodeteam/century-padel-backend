const VIRTUAL_ACCOUNT_BANKS = [
  'BCA',
  'BNI',
  'BRI',
  'MANDIRI',
  'PERMATA',
  'CIMB',
] as const

const EWALLET_CHANNELS = ['DANA', 'OVO', 'LINKAJA', 'SHOPEEPAY', 'GOPAY'] as const

const normalize = (value: string | null | undefined) =>
  String(value || '')
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_')

export function resolveXenditChannelCode(
  channel: string | null | undefined,
  paymentMethodName: string,
) {
  const normalizedChannel = normalize(channel)
  const normalizedName = normalize(paymentMethodName)

  if (normalizedChannel === 'VA') {
    const bank = VIRTUAL_ACCOUNT_BANKS.find((candidate) =>
      normalizedName.includes(candidate),
    )

    if (!bank) {
      throw new Error(
        `Virtual account payment method "${paymentMethodName}" must use a bank-specific Xendit channel code`,
      )
    }

    return `${bank}_VIRTUAL_ACCOUNT`
  }

  if (normalizedChannel === 'EWALLET') {
    const wallet = EWALLET_CHANNELS.find((candidate) =>
      normalizedName.includes(candidate),
    )

    if (!wallet) {
      throw new Error(
        `E-wallet payment method "${paymentMethodName}" must use a provider-specific Xendit channel code`,
      )
    }

    return wallet
  }

  return normalizedChannel
}

export function isVirtualAccountChannel(channel: string | null | undefined) {
  const normalizedChannel = normalize(channel)
  return (
    normalizedChannel === 'VA' ||
    normalizedChannel.endsWith('_VIRTUAL_ACCOUNT')
  )
}
