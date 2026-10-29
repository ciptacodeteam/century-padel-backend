# Membership complimentary quota

Super Admin can grant 1–10,000 whole court hours from **Kelola Pemesanan Membership**.
The grant requires a 3–500 character reason and an idempotency UUID. Replaying an
identical request returns the same grant; reusing its key with different data fails.
The server checks the staff role and active status directly against the database.

`remainingSessions` remains the total usable balance; `remainingComplimentarySessions`
is its complimentary portion. `totalComplimentarySessions` records cumulative grants.
Grant records store the administrator, reason, time, and request key. No invoice,
payment, membership purchase, or revenue entry is created. Existing court coverage
excludes these redeemed hours from new revenue; paid add-ons remain chargeable.

Complimentary uses the existing membership's dates and court-hour restrictions.
It is consumed first within that membership. Suspension and termination therefore
apply to both portions. A depleted membership can receive quota while its original
period has not ended. A funded membership can also receive quota before its start
date; the added hours become usable when that membership starts. Unpaid, refunded,
banned, suspended, or elapsed memberships cannot receive quota. Complimentary cannot be transferred; transfers use only the
non-complimentary balance. A transferred membership that has received additional
complimentary cannot have its original transfer cancelled.

Each booking detail stores its complimentary usage. Cancellation restores the
original split exactly once using a row lock and a persisted restoration marker.
Whole-booking cancellation skips already cancelled individual details. Rescheduling
adjusts both the balance and the detail's split when the duration changes.

## Existing database rollout

The repository has no Prisma migration baseline. Back up the database and apply
`prisma/patches/20261021_membership_complimentary.sql` once before deploying the new
backend, then run `prisma generate`. The additive patch does not modify existing
balances. Deploy the frontend after the schema and backend. For an empty development
database, the updated Prisma schema can also be used with the existing `db:push`
workflow. The SQL patch adds balance checks beyond the Prisma schema.

No application database was changed during implementation. The SQL patch was
applied successfully on a disposable local PostgreSQL database built from the
previous schema. Five integration tests passed for duplicate concurrent grants,
competing checkouts, concurrent cancellation, simultaneous grant and checkout,
and rescheduling followed by cancellation.

To rerun these tests against a disposable database with the schema and patch:

```sh
MEMBERSHIP_TEST_DATABASE_URL='postgresql://...' bun run test tests/membership-complimentary.integration.test.ts
```

Without this explicit variable the integration suite is skipped. Run application
acceptance checks on staging before production rollout.
