import { MembershipType, type Slot } from '@prisma/client'
import dayjs from 'dayjs'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)

export const HAPPY_HOUR_START = 6
export const PEAK_HOUR_START = 16

type MembershipEligibleSlot = Pick<Slot, 'startAt'>
type AllocatableSlot = Pick<Slot, 'id' | 'startAt' | 'endAt'>

type MembershipCandidate = {
  id: string
  remainingSessions: number
  endDate: Date
  membership: { type: MembershipType }
}

export type MembershipSlotAllocation = {
  slotId: string
  membershipUserId: string
}

export function isHappyHourSlot(slot: MembershipEligibleSlot): boolean {
  // Court schedules are persisted as wall-clock values in UTC (for example,
  // the 15:00 local slot is stored as 15:00Z) and returned by the API without
  // timezone conversion. Read the stored clock hour directly; converting it to
  // Asia/Jakarta here would turn 15:00 into 22:00 and reject a valid slot.
  const hour = dayjs.utc(slot.startAt).hour()
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

/**
 * Allocates slots across multiple active memberships. When an explicit mapping
 * is provided it is treated as authoritative. Otherwise the most restricted
 * package is consumed first, then the package expiring soonest.
 */
export function allocateSlotsAcrossMemberships(
  candidates: MembershipCandidate[],
  slots: AllocatableSlot[],
  requestedSlotIds?: Set<string>,
  explicitAllocations?: MembershipSlotAllocation[],
): {
  slotMembershipIds: Map<string, string>
  membershipHours: Map<string, number>
} | null {
  const typePriority: Record<MembershipType, number> = {
    [MembershipType.HAPPY_HOUR]: 0,
    [MembershipType.PEAK_HOUR]: 1,
    [MembershipType.ALL_HOUR]: 2,
  }
  const sortedCandidates = [...candidates].sort((a, b) => {
    const typeComparison =
      typePriority[a.membership.type] - typePriority[b.membership.type]
    return typeComparison || a.endDate.getTime() - b.endDate.getTime()
  })
  const candidatesById = new Map(
    sortedCandidates.map((candidate) => [candidate.id, candidate]),
  )
  const explicitBySlotId = explicitAllocations
    ? new Map(
        explicitAllocations.map((allocation) => [
          allocation.slotId,
          allocation.membershipUserId,
        ]),
      )
    : null
  const remainingByMembershipId = new Map(
    sortedCandidates.map((candidate) => [
      candidate.id,
      candidate.remainingSessions,
    ]),
  )
  const slotMembershipIds = new Map<string, string>()
  const membershipHours = new Map<string, number>()

  for (const slot of [...slots].sort(
    (a, b) => a.startAt.getTime() - b.startAt.getTime(),
  )) {
    if (requestedSlotIds && !requestedSlotIds.has(slot.id)) continue
    if (explicitBySlotId && !explicitBySlotId.has(slot.id)) continue

    const slotHours = Math.max(
      1,
      Math.ceil((slot.endAt.getTime() - slot.startAt.getTime()) / 3_600_000),
    )
    const explicitMembershipId = explicitBySlotId?.get(slot.id)
    const eligibleCandidates = explicitMembershipId
      ? [candidatesById.get(explicitMembershipId)].filter(
          (candidate): candidate is MembershipCandidate => !!candidate,
        )
      : sortedCandidates
    const candidate = eligibleCandidates.find(
      (item) =>
        canMembershipUseSlots(item.membership.type, [slot]) &&
        (remainingByMembershipId.get(item.id) ?? 0) >= slotHours,
    )

    if (!candidate) {
      if (explicitBySlotId || requestedSlotIds) return null
      continue
    }

    slotMembershipIds.set(slot.id, candidate.id)
    membershipHours.set(
      candidate.id,
      (membershipHours.get(candidate.id) ?? 0) + slotHours,
    )
    remainingByMembershipId.set(
      candidate.id,
      (remainingByMembershipId.get(candidate.id) ?? 0) - slotHours,
    )
  }

  const requestedCount = explicitAllocations?.length ?? requestedSlotIds?.size
  if (
    requestedCount !== undefined &&
    slotMembershipIds.size !== requestedCount
  ) {
    return null
  }
  if (slotMembershipIds.size === 0) return null

  return { slotMembershipIds, membershipHours }
}
