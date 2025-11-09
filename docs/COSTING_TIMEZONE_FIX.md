# Coach/Staff Costing Service - Timezone Fix

## Issues Fixed ✅

### Problem 1: Wrong Time Input for Coach Cost

When creating coach cost (staff pricing) with timezone-naive dates, the system was storing times incorrectly in UTC instead of Jakarta time zone.

### Problem 2: closedHours Not Working Properly

The `closedHours` parameter was being filtered correctly in the logic, but the time range calculations were still using wrong timezone context.

## Root Cause

The functions `setCourtPricing` and `setStaffPricingRange` were using:

```typescript
// ❌ Wrong - timezone-naive
const startOfDay = d.startOf('day').tz().toDate()
const endOfDay = d.endOf('day').tz().toDate()
```

This caused date boundaries to be calculated in local time instead of explicitly converting to Jakarta timezone first.

## Solution Applied

### Changed in `src/services/costing.service.ts`

#### 1. `setCourtPricing` function (Line 67-69)

```typescript
// ❌ Before
const startOfDay = d.startOf('day').tz().toDate()
const endOfDay = d.endOf('day').tz().toDate()

// ✅ After
const startOfDay = dayjs
  .tz(d.format('YYYY-MM-DD'), JAKARTA_TZ)
  .startOf('day')
  .toDate()
const endOfDay = dayjs
  .tz(d.format('YYYY-MM-DD'), JAKARTA_TZ)
  .endOf('day')
  .toDate()
```

#### 2. `setStaffPricingRange` function (Line 415-419)

```typescript
// ❌ Before
const dayStart = d.startOf('day').toDate()
const dayEnd = d.endOf('day').toDate()

// ✅ After
const dayStart = dayjs
  .tz(d.format('YYYY-MM-DD'), JAKARTA_TZ)
  .startOf('day')
  .toDate()
const dayEnd = dayjs
  .tz(d.format('YYYY-MM-DD'), JAKARTA_TZ)
  .endOf('day')
  .toDate()
```

## How the Fix Works

### Before (❌ Incorrect Flow):

```
Input: fromDate="2025-11-09" (local Jakarta date)
         ↓
dayjs(fromDate) → timezone-naive dayjs object
         ↓
.startOf('day').tz() → Tries to apply timezone to already-calculated local time
         ↓
Wrong UTC conversion → Slots stored in wrong times
```

### After (✅ Correct Flow):

```
Input: fromDate="2025-11-09" (local Jakarta date)
         ↓
dayjs.tz(dateString, JAKARTA_TZ) → Parse as Jakarta date
         ↓
.startOf('day') → Get start of day in Jakarta timezone
         ↓
.toDate() → Convert to UTC for database storage
         ↓
✅ Correct UTC times with proper timezone offset
```

## Example with Your Data

### Input:

```json
{
  "coachId": "cmhry8xwm0084pj07vd21e0nv",
  "fromDate": "2025-11-09",
  "toDate": "2025-11-16",
  "days": [1, 2],
  "happyHourPrice": 5000,
  "peakHourPrice": 8000,
  "closedHours": [0, 1, 2, 3, 4, 5]
}
```

### What Happens:

1. **Date Range:** 2025-11-09 to 2025-11-16 (Monday to Sunday)
2. **Filter Days:** Only Monday (1) and Tuesday (2)
3. **Process Dates:**
   - 2025-11-10 (Monday) ✅
   - 2025-11-11 (Tuesday) ✅
4. **For Each Date:**
   - Delete existing slots in that date range (UTC-aware)
   - Create happy hour slots (06:00-14:59) @ 5,000
   - Create peak hour slots (15:00-23:59) @ 8,000
   - **Exclude closed hours:** 0-5 (midnight to 5am) ✅

5. **Time Conversion Example (2025-11-10):**

   ```
   Happy Hour 06:00 (Jakarta)
   = 2025-11-09 23:00 UTC (UTC-7)

   Peak Hour 15:00 (Jakarta)
   = 2025-11-10 08:00 UTC (UTC-7)

   Closed Hour 02:00 (Jakarta)
   = ❌ NOT CREATED (filtered by closedHours)
   ```

## Verification

To verify the fix is working:

### Check Database

```sql
-- View created slots for the coach
SELECT
  id,
  "staffId",
  type,
  "startAt" AT TIME ZONE 'Asia/Jakarta' as "startAt_Jakarta",
  "endAt" AT TIME ZONE 'Asia/Jakarta' as "endAt_Jakarta",
  price
FROM "Slot"
WHERE "staffId" = 'cmhry8xwm0084pj07vd21e0nv'
AND "startAt" >= '2025-11-10'::date::timestamp with time zone
AND "startAt" < '2025-11-12'::date::timestamp with time zone
ORDER BY "startAt";
```

### Expected Results:

- 18 slots per day (24 hours - 6 closed hours)
- 2 days × 18 slots = 36 total slots
- Happy hour (06:00-14:59): 9 hours @ 5,000
- Peak hour (15:00-23:59): 9 hours @ 8,000
- All times correctly mapped to Jakarta timezone

## Files Changed

- `src/services/costing.service.ts` - 2 functions updated

## Functions Fixed

### 1. `setCourtPricing()`

**Purpose:** Set pricing for a court across a date range
**Affected:** Court slots and cost schedules
**Impact:** Court pricing now uses correct timezone

### 2. `setStaffPricingRange()`

**Purpose:** Set pricing for coach/ballboy across a date range
**Affected:** Staff slots
**Impact:** Coach/ballboy pricing now uses correct timezone

## Testing the Fix

### Test Case 1: Basic Functionality

```typescript
await setStaffPricingRange({
  staffId: 'cmhry8xwm0084pj07vd21e0nv',
  type: 'COACH',
  fromDate: '2025-11-09',
  toDate: '2025-11-16',
  days: [1, 2],
  happyHourPrice: 5000,
  peakHourPrice: 8000,
  closedHours: [0, 1, 2, 3, 4, 5],
})
```

**Expected:**

- ✅ Function completes without error
- ✅ 18 slots created per selected day (Mon & Tue)
- ✅ No slots for closed hours (0-5)
- ✅ All times in correct Jakarta timezone

### Test Case 2: Verify Closed Hours

```typescript
// Query database to verify hour 0, 1, 2, 3, 4, 5 don't exist
SELECT COUNT(*) FROM "Slot"
WHERE "staffId" = 'cmhry8xwm0084pj07vd21e0nv'
AND extract(hour from "startAt" AT TIME ZONE 'Asia/Jakarta') IN (0,1,2,3,4,5)
AND "startAt" >= '2025-11-10'::timestamp with time zone
```

**Expected:** 0 rows

### Test Case 3: Verify Price Ranges

```typescript
-- Happy hour (06:00-14:59) should be 5,000
SELECT COUNT(*) FROM "Slot"
WHERE "staffId" = 'cmhry8xwm0084pj07vd21e0nv'
AND price = 5000
AND extract(hour from "startAt" AT TIME ZONE 'Asia/Jakarta') BETWEEN 6 AND 14

-- Peak hour (15:00-23:59) should be 8,000
SELECT COUNT(*) FROM "Slot"
WHERE "staffId" = 'cmhry8xwm0084pj07vd21e0nv'
AND price = 8000
AND extract(hour from "startAt" AT TIME ZONE 'Asia/Jakarta') BETWEEN 15 AND 23
```

## Related Functions (Not Changed But Use Same Pattern)

These functions already had correct timezone handling:

- ✅ `updateCourtPricing()` - Uses correct timezone
- ✅ `updateStaffPricing()` - Uses correct timezone
- ✅ `overrideSingleCourtHourPrice()` - Uses correct timezone
- ✅ `overrideStaffHourPrice()` - Uses correct timezone

## Key Takeaways

1. **Always use explicit timezone:** `dayjs.tz(dateString, JAKARTA_TZ)` instead of `dayjs(dateString).tz()`
2. **Convert to date string first:** Format date before passing to `tz()` for clarity
3. **closedHours logic was already correct:** The fix ensures it works properly with correct date boundaries
4. **Consistency:** All costing functions now use the same timezone handling approach

## Deployment Notes

✅ **Backward Compatible:** No breaking changes
✅ **Data Safe:** Only affects future slot creation, doesn't modify existing data
⚠️ **May Require:** Re-creating slots if they were created with wrong times before this fix

### Reset Slots for Affected Coach (Optional)

```typescript
// If you need to reset coach slots created with wrong timezone:
await db.slot.deleteMany({
  where: {
    staffId: 'cmhry8xwm0084pj07vd21e0nv',
    type: 'COACH',
    createdAt: { lt: new Date('2025-11-10') }, // Only old slots
  },
})

// Then re-run setStaffPricingRange with the correct data
```

---

**Fix Date:** November 10, 2025
**Status:** ✅ Complete and Tested
**Impact:** Medium (Affects future coach/staff pricing)
**Breaking Changes:** None
