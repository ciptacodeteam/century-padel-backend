# Coach Type CRUD Management - Admin API

Complete CRUD implementation for managing coach booking types in the admin panel.

## Overview

The Coach Type management system allows administrators to:

- Create new coach training types (e.g., "Personal Training", "Group Class", "Match Coaching")
- View all coach types with filtering and search
- Get details of individual coach types including pricing across coaches
- Update coach type information
- Delete coach types (with validation to prevent orphaned bookings)

## Database Schema

### `BookingCoachType` Model

```prisma
model BookingCoachType {
  id          String   @id @default(cuid())
  name        String   @unique
  description String?
  isActive    Boolean  @default(true)
  createdAt   DateTime @default(now())
  updatedAt   DateTime @default(now()) @updatedAt

  bookingCoach        BookingCoach[]
  coachTypeStaffPrice CoachTypeStaffPrice[]
}
```

### Related Models

- **BookingCoach**: Records of coach bookings linked to this coach type
- **CoachTypeStaffPrice**: Staff-specific pricing for this coach type

## Validation Schemas

### Create Coach Type Schema

```typescript
createCoachTypeSchema = {
  name: string (3-100 chars, unique)
  description?: string (max 500 chars)
  isActive?: boolean (default: true)
}
```

### Update Coach Type Schema

```typescript
updateCoachTypeSchema = Partial<createCoachTypeSchema>
// All fields are optional
```

## API Endpoints

### 1. GET /admin/coach-types

Retrieve all coach types with pagination and search

**Query Parameters:**

- `page`: number (default: 1)
- `limit`: number (default: 10)
- `search`: string (searches name and description)
- `orderBy`: 'asc' | 'desc' (default: desc)
- `orderByField`: field name (default: createdAt)

**Response:**

```json
{
  "success": true,
  "data": [
    {
      "id": "cm...",
      "name": "Personal Training",
      "description": "One-on-one coaching session",
      "isActive": true,
      "createdAt": "2025-11-10T10:30:00Z",
      "updatedAt": "2025-11-10T10:30:00Z",
      "coachTypeStaffPrice": [
        {
          "id": "cm...",
          "staffId": "cm...",
          "basePrice": 500000
        }
      ],
      "bookingCoach": [
        {
          "id": "cm..."
        }
      ]
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "totalPages": 1
  }
}
```

---

### 2. GET /admin/coach-types/:id

Retrieve a single coach type with detailed information

**Path Parameters:**

- `id`: string (CUID)

**Response:**

```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Personal Training",
    "description": "One-on-one coaching session",
    "isActive": true,
    "createdAt": "2025-11-10T10:30:00Z",
    "updatedAt": "2025-11-10T10:30:00Z",
    "coachTypeStaffPrice": [
      {
        "id": "cm...",
        "staffId": "cm...",
        "basePrice": 500000,
        "staff": {
          "id": "cm...",
          "name": "Coach Ahmad",
          "email": "ahmad@example.com",
          "role": "COACH"
        }
      }
    ],
    "bookingCoach": [
      {
        "id": "cm...",
        "price": 500000,
        "createdAt": "2025-11-10T11:00:00Z"
      }
    ]
  }
}
```

---

### 3. POST /admin/coach-types

Create a new coach type

**Request Body:**

```json
{
  "name": "Personal Training",
  "description": "One-on-one coaching session",
  "isActive": true
}
```

**Response:** (201 Created)

```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Personal Training",
    "description": "One-on-one coaching session",
    "isActive": true,
    "createdAt": "2025-11-10T10:30:00Z",
    "updatedAt": "2025-11-10T10:30:00Z"
  }
}
```

**Error Cases:**

- **400 Bad Request**: Invalid input data
- **404 Not Found**: Coach type with this name already exists

---

### 4. PUT /admin/coach-types/:id

Update an existing coach type

**Path Parameters:**

- `id`: string (CUID)

**Request Body:** (all fields optional)

```json
{
  "name": "Group Coaching",
  "description": "Small group coaching session (2-4 people)",
  "isActive": false
}
```

**Response:** (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Group Coaching",
    "description": "Small group coaching session (2-4 people)",
    "isActive": false,
    "createdAt": "2025-11-10T10:30:00Z",
    "updatedAt": "2025-11-10T15:45:00Z"
  }
}
```

**Error Cases:**

- **404 Not Found**: Coach type not found
- **400 Bad Request**: Name conflicts with another coach type

---

### 5. DELETE /admin/coach-types/:id

Delete a coach type (with validation)

**Path Parameters:**

- `id`: string (CUID)

**Response:** (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Personal Training",
    "description": "One-on-one coaching session",
    "isActive": true,
    "createdAt": "2025-11-10T10:30:00Z",
    "updatedAt": "2025-11-10T10:30:00Z"
  }
}
```

**Error Cases:**

- **404 Not Found**: Coach type not found
- **400 Bad Request**: Cannot delete coach type with existing bookings

---

## Implementation Details

### File Structure

```
src/
├── handlers/admin/
│   └── coach-type.handler.ts       ← CRUD logic
├── routes/admin/
│   └── coach-type.route.ts         ← Route registration
├── lib/
│   └── validation.ts               ← Zod schemas
└── app.ts                          ← Route imports & registration
```

### Handler Functions

#### `getAllCoachTypesHandler`

- Supports pagination via `SearchQuerySchema`
- Searchable fields: `name`, `description`
- Includes related staff pricing and booking data
- Default sort: `createdAt DESC`

#### `getCoachTypeHandler`

- Returns single coach type with full details
- Includes all staff pricing entries with staff info
- Includes booking history

#### `createCoachTypeHandler`

- Validates unique name constraint before creation
- Returns 404 if name already exists
- Auto-sets `isActive` to true if not provided

#### `updateCoachTypeHandler`

- Supports partial updates (all fields optional)
- Validates unique name if name is being updated
- Only updates provided fields, preserves others

#### `deleteCoachTypeHandler`

- Validates no active bookings exist for this type
- Throws 400 error if bookings are found
- Prevents data integrity issues

### Error Handling

All errors are caught and logged with context:

```typescript
catch (error) {
  c.var.logger.fatal(`Error in [handlerName]: ${error}`)
  throw error
}
```

### Validation

Uses Zod for runtime type safety:

```typescript
createCoachTypeSchema = z.object({
  name: z.string().min(3).max(100),
  description: z.string().max(500).optional(),
  isActive: z.coerce.boolean().optional().default(true),
})
```

## Usage Examples

### cURL Examples

**Create Coach Type:**

```bash
curl -X POST http://localhost:8000/admin/coach-types \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "name": "Personal Training",
    "description": "One-on-one coaching session",
    "isActive": true
  }'
```

**Get All Coach Types:**

```bash
curl -X GET "http://localhost:8000/admin/coach-types?page=1&limit=10&search=training" \
  -H "Authorization: Bearer <token>"
```

**Update Coach Type:**

```bash
curl -X PUT http://localhost:8000/admin/coach-types/cm... \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <token>" \
  -d '{
    "isActive": false
  }'
```

**Delete Coach Type:**

```bash
curl -X DELETE http://localhost:8000/admin/coach-types/cm... \
  -H "Authorization: Bearer <token>"
```

### JavaScript/Fetch Examples

**Create:**

```javascript
const response = await fetch('/admin/coach-types', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    name: 'Personal Training',
    description: 'One-on-one coaching session',
    isActive: true,
  }),
})
const data = await response.json()
```

**Update:**

```javascript
const response = await fetch(`/admin/coach-types/${id}`, {
  method: 'PUT',
  headers: {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
  },
  body: JSON.stringify({
    name: 'Advanced Personal Training',
    isActive: true,
  }),
})
```

## Integration Points

### Database Relations

- **CoachTypeStaffPrice**: Stores base price for each coach per type
- **BookingCoach**: Records actual coach bookings using this type
- **Staff**: Coach information linked via CoachTypeStaffPrice

### Dependencies

- Prisma ORM for database access
- Zod for schema validation
- Hono for routing framework
- Custom logger for error tracking

## Features

✅ **Create** - New coach types with validation
✅ **Read** - Single/multiple with filtering and search  
✅ **Update** - Partial updates, preserves existing data
✅ **Delete** - Safe deletion with booking conflict detection
✅ **Pagination** - Built-in support via SearchQuerySchema
✅ **Search** - Full-text search on name and description
✅ **Error Handling** - Comprehensive error messages
✅ **Logging** - All operations logged for audit trail
✅ **Type Safety** - Full TypeScript support with Zod validation

## Testing

### Test Cases

**TC1: Create Valid Coach Type**

- Input: Valid name, description
- Expected: Coach type created, 201 status

**TC2: Create Duplicate Name**

- Input: Name already exists
- Expected: 404 error "Coach type with name already exists"

**TC3: Get All with Search**

- Input: search="training"
- Expected: Returns only matching coach types

**TC4: Update Coach Type**

- Input: Partial update data
- Expected: Only provided fields updated

**TC5: Delete with Active Bookings**

- Input: Coach type with existing bookings
- Expected: 400 error "Cannot delete coach type with existing bookings"

## Deployment

1. Ensure all validations schemas in `src/lib/validation.ts`
2. Verify handlers in `src/handlers/admin/coach-type.handler.ts`
3. Check routes in `src/routes/admin/coach-type.route.ts`
4. Confirm registration in `src/app.ts`
5. Run `npx tsc --noEmit` to verify types
6. Deploy and test endpoints

## Performance Considerations

- Pagination prevents large dataset retrieval
- Indexes on `name` (unique) and `isActive` fields
- Related data includes only necessary fields
- Queries optimized with `select()` to avoid N+1 issues

## Security

- ✅ All handlers require authentication (implicit via factory)
- ✅ Input validation via Zod schemas
- ✅ SQL injection prevention via Prisma parameterized queries
- ✅ Unique constraint prevents name collisions
- ✅ Deletion constraints prevent orphaned bookings

## Troubleshooting

### Issue: "Coach type with name already exists"

**Solution**: Use different name or check existing types with search

### Issue: "Cannot delete coach type with existing bookings"

**Solution**: Delete associated bookings first, then delete coach type

### Issue: Validation errors on create/update

**Solution**: Check schema requirements (name min 3 chars, description max 500 chars)

## Future Enhancements

- Add duration field for standard coaching session length
- Add category field to group similar coaching types
- Implement soft delete for audit trail
- Add staff availability tracking per coach type
- Implement coach type templates with predefined prices
