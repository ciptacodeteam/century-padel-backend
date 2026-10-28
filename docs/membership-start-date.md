# Membership start date scheduling

Super Admin can use **Kelola Pemesanan → Membership → menu tindakan → Atur Tanggal Mulai** for an unused, paid purchase. Enter a date and a reason. The UI previews the new period. The same menu is available on mobile cards.

`PUT /admin/membership-transactions/:id/start-date`

```json
{ "startDate": "2026-11-02", "reason": "Permintaan pelanggan" }
```

Dates are calendar dates in Asia/Jakarta. Activation starts at 00:00 WIB, and past dates are rejected. The original stored end-minus-start duration is preserved even if the package duration changes. Payment dates, invoice totals and hour balances remain unchanged. Repeating the same target date does not add another audit entry.

Only active Super Admin accounts may change dates. The membership must be a paid purchase, unexpired, unsuspended and without a refund. Any linked booking (including a cancelled booking), transfer history, or evidence of consumed hours blocks the operation. Untouched complimentary hours are retained. The shared membership row lock serializes this operation with booking consumption and transfers.

Admin detail includes `startDateChanges`, containing previous/new dates, administrator, reason and timestamp. Customer `/memberships/my` adds `upcoming` for funded future memberships. The customer page shows **Menunggu aktif**. Existing date predicates prevent booking benefits and membership schedule access before activation; activation is derived from the current time and requires no scheduled job.

## Deployment

Apply `prisma/patches/20261029_membership_start_date.sql` once before deploying the backend, then generate the Prisma client and deploy backend/frontend together. This additive patch creates only the audit table and does not update existing membership dates. No live database migration is performed by the source change.
