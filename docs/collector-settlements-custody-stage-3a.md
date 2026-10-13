# Collector settlements and custody (Stage 3A)

## Custody recognition

Every new collector precollection explicitly records either `COLLECTOR_HELD` or `COMPANY_RECEIVED`. Payment-method names are not used to infer physical custody. The migration assigns `COLLECTOR_HELD` to rows created before Stage 3A solely as a compatibility assumption; runtime capture always requires an explicit value.

Collector-held captures create one immutable `CUSTOMER_COLLECTION` credit. Cancellation appends a `REVERSAL` debit rather than changing ledger history. Settlement confirmation converts each precollection through the canonical payment registrar and never repeats its custody credit. Explicit remittances debit custody, while company top-ups and authorized adjustments append audited entries.

Declared balance is the signed immutable ledger balance. Pending amount is collector-held custody attached to `RECORDED` or `SUBMITTED` precollections. Confirmed balance is declared balance less that pending amount, and the exposed difference is the pending amount.

## Settlement atomicity and locks

Confirmation is one database transaction. Lock acquisition is financial-close advisory lock, settlement header, settlement items/precollections in deterministic order, and affected loans in deterministic order. The canonical payment registrar receives an internal trusted settlement context so it excludes only the precollection currently being converted from reservation and chronology checks. All other pending precollections remain reserved.

The `collector-settlement:precollection:<id>` payment idempotency namespace is rejected by the regular payment API path. A failed item, closed period, inactive loan, allocation conflict, or custody conflict rolls back all payments, statuses, settlement changes, and remittance entries.

Every successful settlement transition is appended to `collector_settlement_actions`. Settlement detail responses expose this ordered action history with actor, reason, and timestamp; earlier idempotency keys therefore remain replayable after later transitions.

## Deferred loan-disbursement custody debit

`LOAN_DISBURSEMENT` exists as a ledger entry type for forward compatibility, but Stage 3A exposes no endpoint and creates no such debit. Current loan and refinancing disbursement flows do not persist a trustworthy funding collector/source. Consequently, the application MUST NOT infer a custody debit from `createdByUserId`, route ownership, payment method, or assignments. Integration is deferred until disbursement captures an explicit funding source.
