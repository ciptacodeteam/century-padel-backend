import dayjs, { type ManipulateType } from 'dayjs'

export type JwtDuration = {
  amount: number
  unit: ManipulateType
}

export function parseJwtDuration(
  value: string,
  legacyUnit: ManipulateType,
): JwtDuration {
  const trimmed = value.trim()
  const match = trimmed.match(/^(\d+)([smhdw])?$/i)

  if (!match) {
    throw new Error(`Invalid JWT duration: ${value}`)
  }

  const amount = Number(match[1])
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error(`Invalid JWT duration: ${value}`)
  }

  if (match[2]) {
    const units: Record<string, ManipulateType> = {
      s: 'second',
      m: 'minute',
      h: 'hour',
      d: 'day',
      w: 'week',
    }
    return { amount, unit: units[match[2].toLowerCase()] }
  }

  return { amount, unit: legacyUnit }
}

export function addDuration(base: dayjs.Dayjs, duration: JwtDuration) {
  return base.add(duration.amount, duration.unit)
}
