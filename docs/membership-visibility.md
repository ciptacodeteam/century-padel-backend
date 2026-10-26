# Membership public visibility

In the membership create/edit form, **Tampilkan di publik** controls catalog visibility and customer checkout. Turning it off keeps the package available for admin checkout while removing it from the public list and detail endpoints. Customer checkout rejects private package IDs even when submitted directly. `isActive` still controls whether a package can be purchased at all. Previously purchased memberships retain their benefits and customer history.

Existing packages and new packages created without `isPublic` remain public. Updates that omit `isPublic` preserve its current value.

## Deployment

Apply `prisma/patches/20261026_membership_public_visibility.sql` to the target database before deploying the backend, then generate Prisma Client and deploy backend/frontend. The patch adds a boolean column defaulting to `true`; it does not modify membership balances. This repository uses SQL patches without a Prisma migration baseline.

## Rescheduling

Manager uses the persisted role `ADMIN_VIEWER` and can access `PUT /admin/booked-courts/:id/reschedule` through the existing admin authorization. The original slot must start at least 48 hours after the request time; exactly 48 hours is allowed. Both the admin UI and backend enforce this rule. Regression tests cover manager authorization and the cutoff.
