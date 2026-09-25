import { JAKARTA_TZ } from '@/config'
import { MembershipType, type Slot } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)
dayjs.extend(timezone)

export const HAPPY_HOUR_START = 6
export const PEAK_HOUR_START = 16

type MembershipEligibleSlot = Pick<Slot, 'startAt'>
type AllocatableSlot = Pick<Slot, 'id' | 'startAt' | 'endAt'>

export function isHappyHourSlot(slot: MembershipEligibleSlot): boolean {
  const hour = dayjs(slot.startAt).tz(JAKARTA_TZ).hour()
  return hour >= HAPPY_HOUR_START && hour < PEAK_HOUR_START
}

/**
 * Peak Hour and All Hour packages can be used at every court hour.
 * Happy Hour packages are restricted to slots starting from 06:00 through 15:59.
 */
export function canMembershipUseSlots(
  membershipType: MembershipType,
  slots: MembershipEligibleSlot[],
): boolean {
  if (slots.length === 0) return false
  if (membershipType !== MembershipType.HAPPY_HOUR) return true
  return slots.every(isHappyHourSlot)
}

export function allocateMembershipSlots(
  membershipType: MembershipType,
  remainingHours: number,
  slots: AllocatableSlot[],
): { slotIds: Set<string>; hours: number } {
  const slotIds = new Set<string>()
  let hours = 0

  for (const slot of [...slots].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  )) {
    if (!canMembershipUseSlots(membershipType, [slot])) continue
    const slotHours = Math.max(
      1,
      Math.ceil((slot.endAt.getTime() - slot.startAt.getTime()) / 3_600_000),
    )
    if (hours + slotHours > remainingHours) continue
    slotIds.add(slot.id)
    hours += slotHours
  }

  return { slotIds, hours }
}
