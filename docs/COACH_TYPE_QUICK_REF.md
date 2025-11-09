# Coach Type CRUD - Quick Reference

## Endpoints Summary

| Method | Path                     | Purpose                          |
| ------ | ------------------------ | -------------------------------- |
| GET    | `/admin/coach-types`     | List all coach types (paginated) |
| GET    | `/admin/coach-types/:id` | Get single coach type            |
| POST   | `/admin/coach-types`     | Create new coach type            |
| PUT    | `/admin/coach-types/:id` | Update coach type                |
| DELETE | `/admin/coach-types/:id` | Delete coach type                |

## Request/Response Examples

### Create

```bash
POST /admin/coach-types
Content-Type: application/json

{
  "name": "Personal Training",
  "description": "One-on-one session",
  "isActive": true
}

# Response (201)
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Personal Training",
    "description": "One-on-one session",
    "isActive": true,
    "createdAt": "2025-11-10T10:30:00Z",
    "updatedAt": "2025-11-10T10:30:00Z"
  }
}
```

### List with Search

```bash
GET /admin/coach-types?page=1&limit=10&search=training

# Response (200)
{
  "success": true,
  "data": [ ... ],
  "pagination": {
    "page": 1,
    "limit": 10,
    "total": 5,
    "totalPages": 1
  }
}
```

### Get Single

```bash
GET /admin/coach-types/cm...

# Response (200)
{
  "success": true,
  "data": {
    "id": "cm...",
    "name": "Personal Training",
    "description": "One-on-one session",
    "isActive": true,
    "coachTypeStaffPrice": [
      {
        "id": "cm...",
        "staffId": "cm...",
        "basePrice": 500000,
        "staff": { "id": "...", "name": "Coach Ahmad", ... }
      }
    ],
    "bookingCoach": [ ... ]
  }
}
```

### Update

```bash
PUT /admin/coach-types/cm...
Content-Type: application/json

{
  "isActive": false
}

# Response (200) - only provided fields updated
```

### Delete

```bash
DELETE /admin/coach-types/cm...

# Response (200) - returns deleted coach type

# Error (400) if bookings exist:
{
  "success": false,
  "message": "Cannot delete coach type with existing bookings"
}
```

## Validation Rules

- **name**: 3-100 characters, must be unique
- **description**: max 500 characters (optional)
- **isActive**: boolean, defaults to true (optional)

## Error Codes

- `200 OK` - Successful GET/PUT/DELETE
- `201 Created` - Successful POST
- `400 Bad Request` - Validation error or business logic error
- `404 Not Found` - Resource not found

## Files Included

✅ Validation schema in `src/lib/validation.ts`

- `createCoachTypeSchema`
- `updateCoachTypeSchema`

✅ Handler functions in `src/handlers/admin/coach-type.handler.ts`

- `getAllCoachTypesHandler`
- `getCoachTypeHandler`
- `createCoachTypeHandler`
- `updateCoachTypeHandler`
- `deleteCoachTypeHandler`

✅ Routes in `src/routes/admin/coach-type.route.ts`

- Base path: `/coach-types`
- GET, GET/:id, POST, PUT/:id, DELETE/:id

✅ Registered in `src/app.ts`

- Import: `adminCoachTypeRoute`
- Added to: `adminRoutes` array

## TypeScript Compilation

```bash
$ npx tsc --noEmit
# ✅ No errors - clean compilation
```

## Features

✅ Full CRUD operations
✅ Pagination support
✅ Search functionality
✅ Validation with Zod
✅ Error handling
✅ Type safety with TypeScript
✅ Logging for audit trail
✅ Safe deletion (prevents orphaned bookings)
