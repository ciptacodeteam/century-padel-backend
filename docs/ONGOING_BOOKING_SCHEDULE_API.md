# Ongoing Booking Schedule API

## Overview

This API endpoint retrieves the 20 nearest ongoing or upcoming booking schedules based on their slot start times. It shows bookings that are currently happening or will happen soon, sorted by proximity to the current time.

## Endpoint

### GET /admin/bookings/ongoing-schedule

Get 20 nearest booking schedules (ongoing or upcoming) sorted by closest start time.

**Authentication Required:** Yes (Admin)

**Request:**

```
GET /admin/bookings/ongoing-schedule
Authorization: Bearer <admin_token>
```

## Response Format

```json
{
  "success": true,
  "message": "Found 20 ongoing/upcoming bookings",
  "data": [
    {
      "booking": {
        "id": "clxx123abc",
        "userId": "user456",
        "status": "CONFIRMED",
        "totalPrice": 350000,
        "processingFee": 5000,
        "createdAt": "2025-11-17T08:30:00.000Z"
      },
      "user": {
        "id": "user456",
        "name": "John Doe",
        "email": "john@example.com",
        "phone": "+6281234567890",
        "image": "https://example.com/avatar.jpg"
      },
      "schedule": {
        "startAt": "2025-11-17T14:00:00.000Z",
        "endAt": "2025-11-17T16:00:00.000Z",
        "status": "ongoing",
        "minutesFromNow": -15,
        "timeDisplay": "Started 15 minutes ago"
      },
      "courts": [
        {
          "courtId": "court123",
          "courtName": "Court A",
          "courtImage": "https://example.com/court-a.jpg",
          "slotStart": "2025-11-17T14:00:00.000Z",
          "slotEnd": "2025-11-17T16:00:00.000Z",
          "price": 200000
        }
      ],
      "coaches": [
        {
          "staffId": "coach789",
          "staffName": "Coach Mike",
          "staffImage": "https://example.com/coach.jpg",
          "coachType": "Professional",
          "slotStart": "2025-11-17T14:00:00.000Z",
          "slotEnd": "2025-11-17T16:00:00.000Z",
          "price": 150000
        }
      ],
      "ballboys": [],
      "inventories": [],
      "invoice": {
        "id": "inv123",
        "number": "INV-251117-ABC123",
        "status": "PAID",
        "total": 355000,
        "paidAt": "2025-11-17T08:45:00.000Z"
      }
    }
  ]
}
```

## Data Structure

### booking

Core booking information:

- `id` - Booking ID
- `userId` - User who made the booking
- `status` - Booking status (CONFIRMED)
- `totalPrice` - Total price before processing fee
- `processingFee` - Payment processing fee
- `createdAt` - Booking creation timestamp

### user

Customer information:

- `id` - User ID
- `name` - Full name
- `email` - Email address
- `phone` - Phone number
- `image` - Profile image URL

### schedule

Schedule timing and status:

- `startAt` - Earliest slot start time
- `endAt` - Latest slot end time
- `status` - Schedule status:
  - `"upcoming"` - Hasn't started yet
  - `"ongoing"` - Currently happening
  - `"completed"` - Already finished
- `minutesFromNow` - Minutes from current time (negative = already started)
- `timeDisplay` - Human-readable time description

### courts

Array of booked court details:

- `courtId` - Court ID
- `courtName` - Court name
- `courtImage` - Court image URL
- `slotStart` - Slot start time
- `slotEnd` - Slot end time
- `price` - Court rental price

### coaches

Array of booked coach details:

- `staffId` - Coach staff ID
- `staffName` - Coach name
- `staffImage` - Coach profile image
- `coachType` - Type of coach (e.g., "Professional", "Beginner")
- `slotStart` - Coach slot start time
- `slotEnd` - Coach slot end time
- `price` - Coach fee

### ballboys

Array of booked ballboy details:

- `staffId` - Ballboy staff ID
- `staffName` - Ballboy name
- `staffImage` - Ballboy profile image
- `slotStart` - Service start time
- `slotEnd` - Service end time
- `price` - Ballboy fee

### inventories

Array of rented equipment:

- `inventoryId` - Equipment ID
- `inventoryName` - Equipment name
- `quantity` - Number of items
- `price` - Total rental price

### invoice

Payment information:

- `id` - Invoice ID
- `number` - Invoice number
- `status` - Payment status
- `total` - Total amount paid
- `paidAt` - Payment timestamp

## Sorting Logic

Bookings are sorted by **absolute proximity to current time**:

1. **Ongoing bookings** (already started): Sorted by how long ago they started
2. **Upcoming bookings** (not started): Sorted by how soon they will start
3. **The 20 closest** bookings are returned

### Examples:

- Booking starting in 5 minutes → Priority 1
- Booking that started 10 minutes ago → Priority 2
- Booking starting in 15 minutes → Priority 3
- Booking starting in 2 hours → Lower priority

## Schedule Status Classification

### "upcoming"

- Slot start time is in the future
- `minutesFromNow` > 0
- Example: "In 30 minutes"

### "ongoing"

- Slot start time is in the past
- Slot end time is in the future (still happening)
- `minutesFromNow` < 0
- Example: "Started 15 minutes ago"

### "completed"

- Both start and end times are in the past
- Usually filtered out (shows last 2 hours max)
- Example: "Finished 1 hour ago"

## Time Window

The endpoint includes bookings with slots that:

- Started up to **2 hours ago** (to show recently completed/ongoing)
- Are scheduled for any future time

This ensures both:

- Currently active bookings are shown
- Upcoming bookings are prioritized by proximity

## Use Cases

### 1. Reception Dashboard

Show upcoming guests and current activities:

```typescript
// Display next arrivals
const upcomingGuests = bookings.filter((b) => b.schedule.status === 'upcoming')
console.log(
  `Next arrival: ${upcomingGuests[0].user.name} in ${upcomingGuests[0].schedule.timeDisplay}`,
)
```

### 2. Court Management

Track court occupancy in real-time:

```typescript
// Check which courts are currently occupied
const occupiedCourts = bookings
  .filter((b) => b.schedule.status === 'ongoing')
  .flatMap((b) => b.courts.map((c) => c.courtName))
console.log(`Occupied courts: ${occupiedCourts.join(', ')}`)
```

### 3. Staff Scheduling

See coach and ballboy assignments:

```typescript
// Show active staff assignments
const activeStaff = bookings
  .filter((b) => b.schedule.status === 'ongoing')
  .flatMap((b) => [
    ...b.coaches.map((c) => ({ name: c.staffName, role: 'Coach' })),
    ...b.ballboys.map((bb) => ({ name: bb.staffName, role: 'Ballboy' })),
  ])
```

### 4. Timeline View

Create a visual timeline of bookings:

```typescript
// Sort by time and create timeline
const timeline = bookings.map((b) => ({
  time: new Date(b.schedule.startAt),
  customer: b.user.name,
  court: b.courts[0]?.courtName,
  status: b.schedule.status,
}))
```

## Frontend Integration Example

```typescript
interface OngoingBooking {
  booking: {
    id: string
    userId: string
    status: string
    totalPrice: number
    processingFee: number
    createdAt: string
  }
  user: {
    id: string
    name: string
    email: string
    phone: string
    image: string | null
  }
  schedule: {
    startAt: string
    endAt: string
    status: 'upcoming' | 'ongoing' | 'completed'
    minutesFromNow: number
    timeDisplay: string
  }
  courts: Array<{
    courtId: string | null
    courtName: string | null
    courtImage: string | null
    slotStart: string
    slotEnd: string
    price: number
  }>
  coaches: Array<any>
  ballboys: Array<any>
  inventories: Array<any>
  invoice: {
    id: string
    number: string
    status: string
    total: number
    paidAt: string | null
  } | null
}

async function fetchOngoingBookings(): Promise<OngoingBooking[]> {
  const response = await fetch('/admin/bookings/ongoing-schedule', {
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`
    }
  })
  const { data } = await response.json()
  return data
}

// React component example
function OngoingSchedule() {
  const [bookings, setBookings] = useState<OngoingBooking[]>([])

  useEffect(() => {
    // Fetch initially
    fetchOngoingBookings().then(setBookings)

    // Refresh every minute
    const interval = setInterval(() => {
      fetchOngoingBookings().then(setBookings)
    }, 60000)

    return () => clearInterval(interval)
  }, [])

  const ongoingBookings = bookings.filter(b => b.schedule.status === 'ongoing')
  const upcomingBookings = bookings.filter(b => b.schedule.status === 'upcoming')

  return (
    <div>
      <div className="mb-6">
        <h2>Currently Active ({ongoingBookings.length})</h2>
        {ongoingBookings.map(booking => (
          <BookingCard key={booking.booking.id} booking={booking} />
        ))}
      </div>

      <div>
        <h2>Coming Up ({upcomingBookings.length})</h2>
        {upcomingBookings.map(booking => (
          <BookingCard key={booking.booking.id} booking={booking} />
        ))}
      </div>
    </div>
  )
}

function BookingCard({ booking }: { booking: OngoingBooking }) {
  const statusColor = {
    ongoing: 'bg-green-100 text-green-800',
    upcoming: 'bg-blue-100 text-blue-800',
    completed: 'bg-gray-100 text-gray-800'
  }[booking.schedule.status]

  return (
    <div className="border rounded-lg p-4 mb-2">
      <div className="flex justify-between items-start">
        <div>
          <h3 className="font-bold">{booking.user.name}</h3>
          <p className="text-sm text-gray-600">{booking.user.phone}</p>
          <p className="text-sm">
            {booking.courts.map(c => c.courtName).join(', ')}
          </p>
        </div>
        <div className={`px-3 py-1 rounded-full text-sm ${statusColor}`}>
          {booking.schedule.timeDisplay}
        </div>
      </div>

      <div className="mt-2 text-sm">
        <p>
          {new Date(booking.schedule.startAt).toLocaleTimeString()} -
          {new Date(booking.schedule.endAt).toLocaleTimeString()}
        </p>
        {booking.coaches.length > 0 && (
          <p>Coach: {booking.coaches.map(c => c.staffName).join(', ')}</p>
        )}
      </div>
    </div>
  )
}
```

## Performance Considerations

1. **Indexed Queries**: Uses indexed fields (status, startAt)
2. **Filtered Results**: Only fetches CONFIRMED bookings
3. **Limited Time Window**: Only considers last 2 hours to current + future
4. **Top 20 Only**: Returns maximum 20 results for optimal performance
5. **Efficient Sorting**: Client-side sorting after filtering

## Accuracy Guarantee

✅ **100% Accurate Timing**

- Uses earliest slot start time from booking details
- Calculates real-time difference from current moment
- Updates time display on each request

✅ **Status Accuracy**

- "ongoing" = slot started but not ended
- "upcoming" = slot hasn't started
- "completed" = slot has ended

✅ **Sorting Accuracy**

- Sorted by absolute time proximity
- Combines ongoing and upcoming intelligently
- Always shows most relevant bookings first

## Real-time Updates

For live dashboard, poll this endpoint:

```typescript
// Refresh every 30-60 seconds
setInterval(async () => {
  const bookings = await fetchOngoingBookings()
  updateDashboard(bookings)
}, 30000)
```

## Error Handling

- `200 OK` - Successfully retrieved bookings
- `401 Unauthorized` - Missing or invalid auth token
- `403 Forbidden` - User is not an admin
- `500 Internal Server Error` - Database error

## Testing

```bash
# Test the endpoint
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/admin/bookings/ongoing-schedule

# Verify response structure
http GET localhost:3000/admin/bookings/ongoing-schedule \
  Authorization:"Bearer YOUR_ADMIN_TOKEN"
```

## Related Endpoints

- `GET /admin/bookings` - All booking transactions
- `GET /admin/bookings/:id` - Booking detail
- `GET /admin/booked-courts` - Court booking overview
