# Dashboard Stats API - Quick Reference

## Endpoint

```
GET /admin/analytics/dashboard
```

## Response Structure

```json
{
  "success": true,
  "message": "Success",
  "data": {
    "totalRevenue": {
      "value": 2000000,
      "formatted": "Rp 2.000.000",
      "percentageChange": 12.5,
      "trend": "up",
      "description": "Trending up this month",
      "subtitle": "Visitors for the last 6 months"
    },
    "totalSales": {
      "value": 500,
      "percentageChange": 4.5,
      "trend": "up",
      "description": "Steady performance increase",
      "subtitle": "Meets growth projections"
    },
    "newCustomers": {
      "value": 321,
      "percentageChange": -20,
      "trend": "down",
      "description": "Down 20% this period",
      "subtitle": "Acquisition needs attention"
    },
    "activeAccounts": {
      "value": 12,
      "percentageChange": 12.5,
      "trend": "up",
      "description": "Strong user retention",
      "subtitle": "Engagement exceed targets"
    }
  }
}
```

## Calculation Methods

### Total Revenue

- **Source:** `invoice.total` where `status = PAID`
- **Period:** Current month to date
- **Comparison:** Previous full month
- **Query:** `db.invoice.aggregate({ _sum: { total: true } })`

### Total Sales

- **Source:** Count of paid invoices
- **Period:** Current month to date
- **Comparison:** Previous full month
- **Query:** `db.invoice.count({ where: { status: PAID } })`

### New Customers

- **Source:** Count of new user registrations
- **Period:** Current month to date
- **Comparison:** Previous full month
- **Query:** `db.user.count({ where: { createdAt: ... } })`

### Active Accounts

- **Source:** Unique users with paid transactions
- **Period:** Current month to date
- **Comparison:** Previous full month
- **Method:** Set deduplication of userIds from paid invoices

## Percentage Change Formula

```typescript
change =
  previousValue > 0
    ? (((current - previous) / previous) * 100).toFixed(1)
    : current > 0
      ? 100
      : 0
```

## Testing

```bash
# Using curl
curl -H "Authorization: Bearer YOUR_ADMIN_TOKEN" \
  http://localhost:3000/admin/analytics/dashboard

# Using httpie
http GET localhost:3000/admin/analytics/dashboard \
  Authorization:"Bearer YOUR_ADMIN_TOKEN"
```

## Frontend Integration Example

```typescript
// React/Next.js example
interface DashboardStats {
  totalRevenue: {
    value: number
    formatted: string
    percentageChange: number
    trend: 'up' | 'down' | 'stable'
    description: string
    subtitle: string
  }
  totalSales: {
    value: number
    percentageChange: number
    trend: 'up' | 'down' | 'stable'
    description: string
    subtitle: string
  }
  newCustomers: {
    value: number
    percentageChange: number
    trend: 'up' | 'down' | 'stable'
    description: string
    subtitle: string
  }
  activeAccounts: {
    value: number
    percentageChange: number
    trend: 'up' | 'down' | 'stable'
    description: string
    subtitle: string
  }
  period: {
    current: { start: string; end: string }
    previous: { start: string; end: string }
  }
  revenueHistory: {
    last6Months: Array<{ month: string; revenue: number }>
    trend: 'up' | 'down'
  }
}

async function fetchDashboardStats(): Promise<DashboardStats> {
  const response = await fetch('/admin/analytics/dashboard', {
    headers: {
      'Authorization': `Bearer ${getAuthToken()}`
    }
  })
  const { data } = await response.json()
  return data
}

// Usage in component
function DashboardOverview() {
  const [stats, setStats] = useState<DashboardStats | null>(null)

  useEffect(() => {
    fetchDashboardStats().then(setStats)
  }, [])

  if (!stats) return <Loading />

  return (
    <div className="grid grid-cols-4 gap-4">
      <StatCard
        title="Total Revenue"
        value={stats.totalRevenue.formatted}
        change={stats.totalRevenue.percentageChange}
        trend={stats.totalRevenue.trend}
        description={stats.totalRevenue.description}
      />
      <StatCard
        title="Total Sales"
        value={stats.totalSales.value}
        change={stats.totalSales.percentageChange}
        trend={stats.totalSales.trend}
        description={stats.totalSales.description}
      />
      <StatCard
        title="New Customers"
        value={stats.newCustomers.value}
        change={stats.newCustomers.percentageChange}
        trend={stats.newCustomers.trend}
        description={stats.newCustomers.description}
      />
      <StatCard
        title="Active Accounts"
        value={stats.activeAccounts.value}
        change={stats.activeAccounts.percentageChange}
        trend={stats.activeAccounts.trend}
        description={stats.activeAccounts.description}
      />
    </div>
  )
}
```

## Validation

Run the verification tests:

```typescript
import { runAllVerifications } from '@/tests/dashboard-stats-verification'

// In your test file or console
await runAllVerifications()

// Expected output:
// ✅ Revenue Match
// ✅ Sales Match
// ✅ Customers Match
// ✅ Active Accounts Match
// 🎉 ALL VERIFICATIONS PASSED - 100% ACCURACY CONFIRMED
```

## Key Features

✅ **100% Accurate** - Direct database aggregations, no estimations
✅ **Real-time** - Current month data up to the current moment
✅ **Comparative** - Month-over-month percentage changes
✅ **Trend Analysis** - 6-month revenue history included
✅ **Type-safe** - Full TypeScript support
✅ **Optimized** - Uses Prisma aggregates for performance
✅ **Tested** - Comprehensive verification suite included
