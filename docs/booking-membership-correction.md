# Correct complimentary bookings to a paid membership

Super Admin opens **Kelola Pemesanan → booking details → Alihkan ke paket berbayar**,
selects a paid package, reviews the hours and balance, and enters a 5–500 character
reason. Apply each booking separately. No real customer data is changed by deployment.

The backend validates the active administrator from the database. The target must
be a paid PURCHASE belonging to the booking customer, not suspended, banned,
refunded, depleted or elapsed. Its paid balance (total minus complimentary balance)
must cover the entire correction. Every corrected court slot must fall within the
package's dates and permitted hours. This permits historical usage only when its
court date is within the selected package's validity; it does not change activation.

Both standalone credit and injected membership complimentary are supported. A detail
must be entirely complimentary. Details mixing paid/free hours, cancelled/refunded
bookings, or inconsistent balances/totals are rejected for manual review. Existing
paid court details and add-ons are preserved.

Corrections use a serializable database transaction, row locks and a unique audit
record per booking. A retry cannot deduct twice. Conflicting requests roll back and
require reloading. Cancellation locks the booking/detail before reading its source,
so subsequent cancellation restores the corrected paid package exactly once.

Wrongly granted hours already consumed are retired, never restored as usable free
balance. For standalone credit the ledger records a REFUND and an immediate REVOKE
with no net balance change; its original redemption is closed. For injected quota,
the source balance remains unchanged: those free hours were already consumed.
Cumulative grant totals and grant history are retained as historical facts. The old
membership activity records the retired quota as a correction event, excluded from
untracked balance differences. Internal reasons and admin IDs stay out of customer activity.
Unused free balances outside these bookings are not revoked.

Court performance reports automatically move corrected details from Complimentary
to the selected membership category, on their original court dates. Invoice amounts,
payment dates and cash revenue remain unchanged: package purchases are already
included in revenue. No new cash sale or extra retail-price revenue is fabricated.
The correction audit stores the target, original per-detail sources, administrator,
hours, reason and time; booking details display its reason and administrator.

## Existing database rollout

This repository uses additive SQL patches rather than a migration baseline. Apply
`prisma/patches/20261125_booking_membership_correction.sql` once before deploying the
backend, then run `prisma generate`. Deploy the frontend after the backend. The
patch creates only the audit table and constraints, with no balance updates. For
an empty development database, use the normal Prisma `db:push` workflow.

Run integration tests against an explicitly selected disposable PostgreSQL database:

```sh
MEMBERSHIP_TEST_DATABASE_URL='postgresql://...' bun run test tests/booking-membership-correction.integration.test.ts
```

Without that variable these integration tests are skipped. Regular tests cover
route permissions, input validation and frontend confirmation/preview behavior.
