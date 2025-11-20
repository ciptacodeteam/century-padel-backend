# Admin Viewer Role Implementation

## Overview
The `ADMIN_VIEWER` role has been added to provide read-only access to all admin endpoints. Users with this role can view all data but cannot create, update, or delete any records.

## Changes Made

### 1. Schema Updates (`prisma/schema.prisma`)
- Added `ADMIN_VIEWER` to the `Role` enum
- Applied to database using `prisma db push`

### 2. Validation Schema (`src/lib/validation.ts`)
- Updated staff validation to include `ADMIN_VIEWER` in allowed roles
- Staff can be created/updated with the `ADMIN_VIEWER` role

### 3. Middleware Updates (`src/middlewares/auth.ts`)

#### New Middlewares
- `requireAdminViewer`: Requires the user to have `ADMIN_VIEWER` role
- `requireAdminOrViewer`: Allows both `ADMIN` and `ADMIN_VIEWER` roles
- `requireAdminWriteAccess`: Only allows `ADMIN` role (blocks `ADMIN_VIEWER`)
- `blockAdminViewerWrites`: Automatically blocks POST, PUT, PATCH, DELETE requests from `ADMIN_VIEWER`

### 4. Global Admin Route Protection (`src/app.ts`)
- Applied `requireAdminAuth` and `blockAdminViewerWrites` to all `/admin/*` routes
- Public auth endpoints are excluded from authentication:
  - `/admin/auth/login`
  - `/admin/auth/register`
  - `/admin/auth/refresh-token`
  - `/admin/auth/check-account`

## How It Works

### Read Access (GET)
- `ADMIN_VIEWER` can access all GET endpoints
- Examples:
  - View all users: `GET /admin/customers`
  - View staff details: `GET /admin/staffs/:id`
  - View bookings: `GET /admin/booked-courts`
  - View analytics: `GET /admin/analytics`

### Write Access (POST, PUT, PATCH, DELETE)
- `ADMIN_VIEWER` is **blocked** from all write operations
- Attempting to perform write operations returns:
  - Status: `403 Forbidden`
  - Message: "Admin viewer role has read-only access. Write operations are not permitted."

### Examples of Blocked Operations
- Creating staff: `POST /admin/staffs`
- Updating users: `PUT /admin/customers/:id`
- Deleting courts: `DELETE /admin/courts/:id`
- Banning users: `PUT /admin/customers/:id/ban`
- Creating bookings: `POST /admin/checkout`

## Usage

### Creating Admin Viewer Staff
```json
POST /admin/staffs
{
  "name": "John Viewer",
  "email": "john.viewer@example.com",
  "phone": "081234567890",
  "password": "securepassword",
  "confirmPassword": "securepassword",
  "role": "ADMIN_VIEWER",
  "isActive": true
}
```

### Login as Admin Viewer
```json
POST /admin/auth/login
{
  "email": "john.viewer@example.com",
  "password": "securepassword"
}
```

The returned token will have `role: "ADMIN_VIEWER"` in the payload.

## Benefits

1. **Security**: Prevents accidental or unauthorized data modifications
2. **Auditing**: Can assign viewer role to auditors or stakeholders who need visibility
3. **Training**: Safe environment for new staff to learn the system
4. **Reporting**: External teams can access data for reports without modification risk
5. **Automatic**: No need to modify individual route handlers - protection is applied globally

## Technical Notes

- The write protection is enforced at the HTTP method level
- All admin routes automatically inherit this protection
- The middleware checks both authentication AND role permissions
- Error messages are clear and indicate the permission issue
- Compatible with existing `ADMIN`, `COACH`, `BALLBOY`, and `CASHIER` roles
