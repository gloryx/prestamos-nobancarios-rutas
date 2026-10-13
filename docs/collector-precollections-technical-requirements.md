# Collector precollection technical requirements

The future precollection flow must preserve the day the customer handed money to the collector as the payment's financial date. Administrative settlement may happen later, but it must not silently move the payment into the settlement date or bypass financial-close protections.

## Posting contract

1. Capture the customer collection date as an immutable date-only value on the precollection.
2. Validate the date when the precollection is recorded and revalidate it when settlement is confirmed.
3. Confirm an entire settlement in one database transaction by calling `TransactionalPaymentRegistrar` with the transaction's `EntityManager`.
4. Use one deterministic idempotency key per precollection-to-payment conversion.
5. Roll back every payment and settlement transition if any item fails.
6. Never create a second `CUSTOMER_PAYMENT` cash inflow when the collector later hands the same money to the company.

The current registrar rejects a payment dated before the latest valid payment and mutates the current payment plan. Stage 2 therefore cannot post an older precollection after newer canonical payments without an explicit ordering policy. The preferred safe policy is to block newer posting for a loan while it has an earlier unsettled precollection; deterministic financial replay would be a larger alternative and must not be introduced implicitly.

## Closed periods

A precollection whose customer collection date belongs to a closed financial period cannot be posted as a canonical payment without an explicit correction workflow. Settlement confirmation must fail closed and leave every item pending; it must not substitute the settlement date, reopen a period, or partially post the batch.

Before implementing retroactive posting, define an authorized exception policy with audit reason, approver identity, immutable timestamps, and reconciliation behavior. No such exception exists in Stage 1.

## Collector custody boundary

Collector custody is a separate operational subledger, not a replacement for canonical payments or cash movements. Its conceptual balance is:

`opening balance + customer collections + company funds delivered - real disbursements - funds returned to the company +/- authorized adjustments`

Each custody entry must identify its source, effective date, collector profile, actor, idempotency key, and reversal relationship. Refinancing contributes only additional cash actually disbursed; transferred outstanding principal is not a cash outflow.

## Stage 2 gate

- Define precollection states and legal transitions.
- Define permissions without granting them to roles automatically.
- Define settlement conflict and retry semantics.
- Define how closed-period exceptions are authorized before allowing retroactive posting.
- Add persistence constraints and PostgreSQL concurrency tests before exposing endpoints.

## Device and frontend contract

The collector experience is mobile-first. `GET /collector-precollections/mine` must remain compact, paginated, server-filtered, and scoped to the authenticated collector. Its date contract exposes the selected Costa Rica business date plus previous, today, and non-future next navigation. Create and cancel commands use client-generated idempotency keys so a connection retry cannot duplicate an operation. Offline storage and automatic synchronization are explicitly out of scope until separately authorized.

The future collector UI must use one-hand-friendly controls, card-based results without mandatory horizontal scrolling, compact indicators, visible statuses, simple customer or loan search, calendar selection, and quick access to record a collection. It must show loading, retryable connectivity failures, and duplicate-submit prevention.

The collection-manager and administrator experience is desktop-first. The global endpoint supports server-side periods, collector, route, status, payment method, search, sorting, and pagination for dense tables and operational review. Capabilities remain permission-driven; collection managers and administrators must not be treated as equivalent roles.

Both experiences use the same backend and financial rules. Screen size never determines authorization, and no frontend may duplicate operational-balance, closed-period, assignment, or state-transition policy.
