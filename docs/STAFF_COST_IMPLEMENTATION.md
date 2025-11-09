# Staff Cost Handler Implementation

## Overview

Created comprehensive staff costing handlers following the same pattern as coach and ballboy costing, allowing generic staff members (COACH and BALLBOY roles) to have their pricing managed.

## Files Created

### 1. **src/handlers/admin/staff-cost.handler.ts** (205 lines)

Complete CRUD handlers for staff costing management:

#### Handlers:

- **`getStaffCostHandler`** - Retrieves all staff cost slots (coaches and ballboys)
  - Supports pagination and search
  - Returns slots ordered by availability
- **`createStaffCostHandler`** - Creates pricing range for a staff member
  - Validates staff exists
  - Validates staff is not ADMIN role
  - Sets pricing for COACH or BALLBOY slot type
  - Requires: staffId, fromDate, toDate, days, happyHourPrice, peakHourPrice, closedHours (optional)
- **`updateStaffCostHandler`** - Updates pricing for a specific date
  - Validates staff role
  - Updates COACH or BALLBOY pricing
  - Requires: id (param), date, happyHourPrice, peakHourPrice, closedHours (optional)
- **`overrideSingleStaffCostHandler`** - Overrides pricing for a specific hour on a date
  - Validates staff role
  - Overrides single hour pricing
  - Requires: staffId, date, hour, price

#### Features:

- Automatic role-based slot type mapping (COACH → SlotType.COACH, BALLBOY → SlotType.BALLBOY)
- Comprehensive error handling with descriptive messages
- Full logging for debugging
- Uses existing costing service (`setStaffPricingRange`, `updateStaffPricing`, `overrideStaffHourPrice`)

### 2. **src/routes/admin/staff-cost.route.ts** (15 lines)

Route definitions for staff costing endpoints:

```
GET    /admin/staff-costs           - List all staff costs
POST   /admin/staff-costs           - Create staff pricing
PUT    /admin/staff-costs/:id       - Update staff pricing for date
PUT    /admin/staff-costs/override  - Override single hour pricing
```

### 3. **src/lib/validation.ts** (Modified - 16 lines added)

Added validation schemas for staff costing:

```typescript
export const createStaffCostSchema = createCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type CreateStaffCostSchema = z.infer<typeof createStaffCostSchema>

export const updateStaffCostSchema = updateCourtCostSchema

export type UpdateStaffCostSchema = z.infer<typeof updateStaffCostSchema>

export const overrideSingleStaffCostSchema = overrideSingleCourtCostSchema
  .omit({ courtId: true })
  .extend({
    staffId: z.string(),
  })

export type OverrideSingleStaffCostSchema = z.infer<
  typeof overrideSingleStaffCostSchema
>
```

### 4. **src/app.ts** (Modified - 2 lines added)

- Added import: `import adminStaffCostRoute from './routes/admin/staff-cost.route'`
- Added to adminRoutes array: `adminStaffCostRoute`

### 5. **src/routes/admin/staff.route.ts** (Modified - Import updates)

Updated imports to use staff-cost handlers:

- Now imports `getStaffCostHandler` and `createStaffCostHandler` from staff-cost.handler
- Routes updated to use correct handler names

## API Endpoints

### 1. Get Staff Costs

```
GET /admin/staff-costs
Query Parameters:
  - page (optional): Page number
  - limit (optional): Items per page
  - sortBy (optional): Sort field
  - order (optional): asc or desc
  - search (optional): Search term
  - from (optional): Start date
  - to (optional): End date

Response: List of staff cost slots ordered by availability
```

### 2. Create Staff Pricing

```
POST /admin/staff-costs
Body: {
  "staffId": "uuid",
  "fromDate": "YYYY-MM-DD",
  "toDate": "YYYY-MM-DD",
  "days": [0, 1, 2, 3, 4, 5, 6], // 0 = Sunday, 6 = Saturday
  "happyHourPrice": 50000,
  "peakHourPrice": 100000,
  "closedHours": [6, 7, 23] // Optional: hours to close
}

Returns: Success message upon creation
```

### 3. Update Staff Pricing for Date

```
PUT /admin/staff-costs/:id
Body: {
  "date": "YYYY-MM-DD",
  "happyHourPrice": 50000,
  "peakHourPrice": 100000,
  "closedHours": [6, 7, 23] // Optional
}

Returns: Success message upon update
```

### 4. Override Single Hour Pricing

```
PUT /admin/staff-costs/override
Body: {
  "staffId": "uuid",
  "date": "YYYY-MM-DD",
  "hour": 10,
  "price": 75000
}

Returns: Success message upon override
```

## Error Handling

The handlers include comprehensive error handling:

| Error                    | HTTP Status | Message                                       |
| ------------------------ | ----------- | --------------------------------------------- |
| Staff not found          | 404         | "Staff not found"                             |
| Staff is ADMIN           | 400         | "The specified staff cannot have pricing set" |
| Pricing operation failed | 500         | "Failed to set/update staff pricing"          |
| Invalid schema           | 400         | Validation error details                      |

## Integration with Existing Services

Uses the existing costing service functions:

- `setStaffPricingRange` - Creates pricing range
- `updateStaffPricing` - Updates pricing for a date
- `overrideStaffHourPrice` - Overrides single hour price

These functions handle the actual database operations and slot creation.

## Key Features

✅ **Flexible Staff Role Support** - Works with any staff member (COACH or BALLBOY)
✅ **Automatic Type Mapping** - Automatically maps staff role to correct SlotType
✅ **Comprehensive Validation** - Zod-based schema validation
✅ **Full Error Handling** - Descriptive error messages
✅ **Logging Integration** - All operations logged via Pino logger
✅ **Consistent Pattern** - Follows coach-cost and ballboy-cost patterns
✅ **TypeScript Safe** - Full type safety with generics

## Validation Rules

- **staffId**: Must be a valid staff member ID
- **fromDate**: Must be in YYYY-MM-DD format
- **toDate**: Must be in YYYY-MM-DD format
- **days**: Array of numbers (0-6, where 0 is Sunday)
- **happyHourPrice**: Must be >= 0
- **peakHourPrice**: Must be >= 0
- **closedHours**: Optional array of hours (0-23) to close
- **date**: Must be in YYYY-MM-DD format (for updates)
- **hour**: Must be >= 0
- **price**: Must be >= 0

## Testing

To test the endpoints:

```bash
# Get all staff costs
curl -X GET http://localhost:8000/admin/staff-costs \
  -H "Authorization: Bearer <token>"

# Create staff pricing
curl -X POST http://localhost:8000/admin/staff-costs \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "staffId": "staff-uuid",
    "fromDate": "2025-11-01",
    "toDate": "2025-11-30",
    "days": [1, 2, 3, 4, 5],
    "happyHourPrice": 50000,
    "peakHourPrice": 100000
  }'

# Update staff pricing for date
curl -X PUT http://localhost:8000/admin/staff-costs/staff-uuid \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "date": "2025-11-15",
    "happyHourPrice": 60000,
    "peakHourPrice": 110000
  }'

# Override single hour pricing
curl -X PUT http://localhost:8000/admin/staff-costs/override \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "staffId": "staff-uuid",
    "date": "2025-11-15",
    "hour": 14,
    "price": 150000
  }'
```

## Verification

✅ TypeScript compilation: **CLEAN** (0 errors)
✅ All handlers exported correctly
✅ Routes properly registered in app.ts
✅ Validation schemas properly typed
✅ Follows project conventions and patterns

## Implementation Complete

The staff costing handler is ready for deployment and follows the same robust pattern as the coach and ballboy costing implementations.

---

**Created**: November 10, 2025
**Last Verified**: TypeScript ✅, All imports ✅, Routes registered ✅
