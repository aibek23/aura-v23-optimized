# Critical-error fixes

Base commit: `0e9f284558745a4065c11cc87ddb3068427ac1dd`.

## Changes

- Offline returns use the existing `return_sale_item` database transaction rather
  than independent cash, return and product writes. The server calculates refund
  amounts and payment sources. A lost-response retry must find the exact existing
  shop/sale/item return before it is considered delivered.
- Confirmed return/cash rows replace optimistic local rows in one IndexedDB
  transaction, avoiding duplicate local totals after synchronization.
- Unique-constraint errors and HTTP 409 responses no longer silently remove an
  operation from the outbox. Real idempotent replays are handled by the RPC/upsert;
  unresolved conflicts remain available for review.
- Concurrent outbox flush triggers in one tab are serialized.
- Public `/q/...` product links bypass the authentication proxy; private `/stores`
  and CRM routes remain protected.
- Auth callback destinations are parsed and checked against the application's
  origin, including backslash and whitespace normalization.
- Raise dependency minimums to Next 16.4.5, Supabase JS 2.118.0, Supabase SSR
  0.12.7, shadcn 4.23.0 and niimbot-web-bluetooth 2.6.0; update the Hono override.
  Refresh the npm lockfile. Standardize on npm rather than retaining three
  inconsistent lockfiles that can install different security-sensitive versions.

## Verification

Run with Node 24 (the critical regression tests need Node >=22.13):

```sh
npm ci
npm run test:critical
npm run test:export
npm run test:product-units
npm run typecheck
npm run build
npm audit
```

The critical regressions exercise the actual TypeScript with mocked external
services, not a live database. They cover public/private route matching, callback
redirects, unique conflicts, overlapping flushes, return atomicity and retries,
and replacement of optimistic local rows.

Before these changes, the npm lockfile audit reported 20 vulnerable dependency
entries: 1 critical, 10 high, 8 moderate and 1 low. This is a dependency advisory
result, not evidence that every advisory is exploitable in this application.
The image-optimization RCE advisory, for example, is configuration-dependent;
the app currently sets `images.unoptimized: true`. Updating the framework is
still necessary, including for applicable Server Actions advisories.

No production database migrations, data repairs, merges or production deployments
are included. Existing partially applied returns need a separate reconciliation;
this patch prevents new multi-request partial returns but does not retroactively
repair accounting records.
