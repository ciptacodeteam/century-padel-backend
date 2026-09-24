import { JAKARTA_TZ } from '@/config'
import { db } from '@/lib/prisma'
import { PaymentStatus } from '@prisma/client'
import dayjs from 'dayjs'
import timezone from 'dayjs/plugin/timezone.js'
import utc from 'dayjs/plugin/utc.js'

dayjs.extend(utc)
dayjs.extend(timezone)

export const DEFAULT_SCHEDULE_VISIBILITY_MONTHS = 1

/**
 * Horizon is the last bookable day for a rolling visibility window of N months.
 * Example (Jakarta): 24 September with N=1 → 24 October;
 * N=4 → 24 January.
 */
export function getScheduleVisibilityHorizonDate(
  months: number = DEFAULT_SCHEDULE_VISIBILITY_MONTHS,
  now: Date = new Date(),
): Date {
  const visibilityMonths = Math.max(DEFAULT_SCHEDULE_VISIBILITY_MONTHS, months)

  return dayjs(now)
    .tz(JAKARTA_TZ)
    .add(visibilityMonths, 'month')
    .endOf('day')
    .toDate()
}

export async function getUserScheduleVisibilityMonths(
  userId: string | null | undefined,
): Promise<number> {
  if (!userId) {
    return DEFAULT_SCHEDULE_VISIBILITY_MONTHS
  }

  const now = new Date()
  const activeMemberships = await db.membershipUser.findMany({
    where: {
      userId,
      isExpired: false,
      isSuspended: false,
      startDate: { lte: now },
      endDate: { gt: now },
      invoice: {
        status: PaymentStatus.PAID,
      },
    },
    select: {
      membership: {
        select: {
          scheduleVisibilityMonths: true,
        },
      },
    },
  })

  if (activeMemberships.length === 0) {
    return DEFAULT_SCHEDULE_VISIBILITY_MONTHS
  }

  return Math.max(
    DEFAULT_SCHEDULE_VISIBILITY_MONTHS,
    ...activeMemberships.map(
      (item) => item.membership.scheduleVisibilityMonths,
    ),
  )
}

export async function getUserScheduleVisibilityHorizon(
  userId: string | null | undefined,
  now: Date = new Date(),
): Promise<{ months: number; horizon: Date }> {
  const months = await getUserScheduleVisibilityMonths(userId)
  return {
    months,
    horizon: getScheduleVisibilityHorizonDate(months, now),
  }
}

export function isDateWithinScheduleVisibility(
  date: Date,
  horizon: Date,
): boolean {
  return !dayjs(date).tz(JAKARTA_TZ).isAfter(dayjs(horizon).tz(JAKARTA_TZ), 'day')
}
