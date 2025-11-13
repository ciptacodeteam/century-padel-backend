# Club CRUD API for Non-Admin Users

## Overview
This implementation provides a complete CRUD API for non-admin users to manage their own clubs. Users can create, read, update, and delete clubs they have created, while also being able to browse public clubs.

## Handlers (`src/handlers/club.handler.ts`)

### User Club Management Endpoints

1. **Get My Clubs** - `getMyClubsHandler`
   - Returns all clubs where the authenticated user is the leader
   - Includes member count
   - Supports search and pagination

2. **Get My Club by ID** - `getMyClubHandler`
   - Returns a specific club only if the user is the leader
   - Includes member count
   - Returns 403 if user is not the leader

3. **Create Club** - `createMyClubHandler`
   - Creates a new club with the authenticated user as leader
   - Validates unique club name
   - Handles logo upload
   - Automatically sets the user as the club leader

4. **Update Club** - `updateMyClubHandler`
   - Updates club details only if user is the leader
   - Validates unique club name (if changed)
   - Handles logo replacement
   - Users cannot change `leaderId` or `isActive` (admin only)

5. **Delete Club** - `deleteMyClubHandler`
   - Deletes club only if user is the leader
   - Removes uploaded logo file
   - Returns 403 if user is not the leader

### Public Club Browsing Endpoints

6. **Get All Public Clubs** - `getAllPublicClubsHandler`
   - Returns all public and active clubs
   - Anyone can access (no auth required)
   - Includes member count
   - Supports search and pagination

7. **Get Public Club by ID** - `getPublicClubHandler`
   - Returns a specific public club
   - Private clubs only accessible by their leader
   - Includes member count

## Routes (`src/routes/club.route.ts`)

### Protected Routes (Require Authentication)
- `GET /clubs/my` - Get all clubs created by user
- `GET /clubs/my/:id` - Get specific club created by user
- `POST /clubs` - Create a new club
- `PUT /clubs/:id` - Update a club (if leader)
- `DELETE /clubs/:id` - Delete a club (if leader)

### Public Routes (No Authentication Required)
- `GET /clubs` - Get all public clubs
- `GET /clubs/:id` - Get a specific public club

## Authorization Logic

### Create
- Any authenticated user can create a club
- User automatically becomes the club leader

### Read
- Users can view all their own clubs (public or private)
- Anyone can view public clubs
- Only leaders can view their private clubs

### Update
- Only the club leader can update their club
- Users cannot change `leaderId` or `isActive` fields

### Delete
- Only the club leader can delete their club
- Associated files (logos) are automatically deleted

## Key Features

1. **Automatic Leader Assignment**: When creating a club, the authenticated user is automatically set as the leader
2. **Member Count**: All club responses include the count of club members
3. **Privacy Controls**: Private clubs are only visible to their leaders
4. **File Management**: Logo uploads and deletions are handled automatically
5. **Validation**: Club names must be unique across the system
6. **Authorization**: Proper checks ensure users can only modify clubs they lead

## API Registration

The route is registered in `src/app.ts`:
```typescript
import clubRoute from './routes/club.route'

const routes = [
  // ... other routes
  clubRoute,
]
```

## Differences from Admin API

The admin API (`/admin/clubs`) allows:
- Viewing all clubs (public and private)
- Updating any club
- Deleting any club
- Changing `leaderId` and `isActive` status

The user API (`/clubs`) restricts users to:
- Only managing clubs they created (as leader)
- Cannot change `leaderId` or `isActive`
- Can only view public clubs unless they are the leader

## Example Usage

### Create a Club
```bash
POST /clubs
Authorization: Bearer <user_token>
Content-Type: multipart/form-data

name: "My Tennis Club"
description: "A club for tennis enthusiasts"
visibility: "PUBLIC"
logo: <file>
```

### Get My Clubs
```bash
GET /clubs/my?search=tennis&page=1&limit=10
Authorization: Bearer <user_token>
```

### Update My Club
```bash
PUT /clubs/:id
Authorization: Bearer <user_token>
Content-Type: multipart/form-data

name: "Updated Club Name"
description: "New description"
```

### Browse Public Clubs
```bash
GET /clubs?search=tennis&page=1&limit=10
# No authentication required
```
