# Testing Guide for Club CRUD API

## Test Data Summary

The seed script has created **4 test users** and **5 clubs** with various relationships.

### Test Users (All use password: `Password123!`)

1. **John Smith** - `john.smith@example.com` / `+6281234567890`
   - Leader of: Elite Tennis Club, Morning Fitness Tennis
   - Member of: Weekend Warriors Badminton, Pro Squash Academy, Community Sports Hub

2. **Sarah Johnson** - `sarah.johnson@example.com` / `+6281234567891`
   - Leader of: Weekend Warriors Badminton
   - Member of: Elite Tennis Club, Community Sports Hub

3. **Michael Chen** - `michael.chen@example.com` / `+6281234567892`
   - Leader of: Pro Squash Academy (PRIVATE)
   - Member of: Elite Tennis Club, Morning Fitness Tennis, Community Sports Hub

4. **Emma Williams** - `emma.williams@example.com` / `+6281234567893`
   - Leader of: Community Sports Hub
   - Member of: Weekend Warriors Badminton, Morning Fitness Tennis

## API Testing Scenarios

### 1. Login and Get Auth Token

```bash
# Login as John Smith
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+6281234567890",
    "password": "Password123!"
  }'

# Save the token from response
TOKEN="<your_token_here>"
```

### 2. View All Public Clubs (No Auth Required)

```bash
curl http://localhost:3000/clubs
```

**Expected Result:** 4 public clubs (excludes "Pro Squash Academy" which is private)

### 3. View Specific Public Club

```bash
curl http://localhost:3000/clubs/<club_id>
```

### 4. View My Clubs (Authenticated)

```bash
curl http://localhost:3000/clubs/my \
  -H "Authorization: Bearer $TOKEN"
```

**Expected Result for John:** 2 clubs (Elite Tennis Club, Morning Fitness Tennis)

### 5. View Specific Club I Lead

```bash
curl http://localhost:3000/clubs/my/<club_id> \
  -H "Authorization: Bearer $TOKEN"
```

### 6. Create a New Club

```bash
curl -X POST http://localhost:3000/clubs \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=New Test Club" \
  -F "description=A brand new club for testing" \
  -F "visibility=PUBLIC" \
  -F "rules=1. Be nice\n2. Have fun"
```

### 7. Update My Club

```bash
curl -X PUT http://localhost:3000/clubs/<club_id> \
  -H "Authorization: Bearer $TOKEN" \
  -F "name=Updated Club Name" \
  -F "description=Updated description"
```

### 8. Try to Update Someone Else's Club (Should Fail)

```bash
# Login as Sarah
curl -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "phone": "+6281234567891",
    "password": "Password123!"
  }'

# Try to update John's club (Elite Tennis Club)
curl -X PUT http://localhost:3000/clubs/<johns_club_id> \
  -H "Authorization: Bearer $SARAH_TOKEN" \
  -F "name=Trying to hack"
```

**Expected Result:** 403 Forbidden

### 9. Delete My Club

```bash
curl -X DELETE http://localhost:3000/clubs/<club_id> \
  -H "Authorization: Bearer $TOKEN"
```

### 10. Try to Access Private Club as Non-Leader

```bash
# Get Pro Squash Academy ID (Michael's private club)
# Login as Sarah and try to access it
curl http://localhost:3000/clubs/<pro_squash_academy_id> \
  -H "Authorization: Bearer $SARAH_TOKEN"
```

**Expected Result:** 403 Forbidden "This club is private"

## Search and Pagination

### Search Clubs

```bash
# Search for tennis clubs
curl "http://localhost:3000/clubs?search=tennis"

# Paginated results
curl "http://localhost:3000/clubs?page=1&limit=10"

# Search my clubs
curl "http://localhost:3000/clubs/my?search=elite" \
  -H "Authorization: Bearer $TOKEN"
```

## Response Examples

### Successful Club Retrieval

```json
{
  "success": true,
  "data": [
    {
      "id": "club_id_here",
      "name": "Elite Tennis Club",
      "description": "A premier tennis club for professionals and enthusiasts...",
      "logo": null,
      "rules": "1. Respect all members\n2. Book courts in advance...",
      "leaderId": "user_id_here",
      "visibility": "PUBLIC",
      "isActive": true,
      "createdAt": "2025-11-13T...",
      "updatedAt": "2025-11-13T...",
      "_count": {
        "clubMember": 2
      }
    }
  ]
}
```

### Error Response - Not Club Leader

```json
{
  "success": false,
  "message": "Only the club leader can update the club"
}
```

### Error Response - Club Not Found

```json
{
  "success": false,
  "message": "Club not found"
}
```

## Frontend Integration Tips

1. **Store the auth token** after login in localStorage or secure storage
2. **Include Authorization header** in all authenticated requests
3. **Handle 401/403 errors** to redirect to login or show permission errors
4. **Show member count** from `_count.clubMember` field
5. **Display visibility badge** (PUBLIC/PRIVATE) in club cards
6. **Filter clubs by leader** to show "My Clubs" section

## Re-seeding Database

If you need to reset the test data:

```bash
# Clear all data
bun run prisma/truncate.ts

# Re-seed
bun run prisma/seed.ts
```

## Notes

- All phone numbers use Indonesian format (+628...)
- Passwords are hashed using Argon2
- Club names must be unique
- Users automatically become leaders when they create clubs
- Private clubs are only visible to their leaders
- Logo uploads are optional (set to null in seed data)
