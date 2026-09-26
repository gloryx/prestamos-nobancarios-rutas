# Design: Add Payments Domain

## Technical Approach

Add immutable Payment facts around the existing mutable `payment_plan_entries` projection. Domain/application code owns allocation and invariants; TypeORM/PostgreSQL owns transactions and constraints; Nest/React remain adapters. This phase changes no production code, migration, or database.

## Architecture Decisions

| Decision | Choice and rationale |
|---|---|
| Money | Every persisted/API amount is a `NUMERIC(18,2)` decimal string. Existing bigint-cent helpers are allowed only at validation/calculation boundaries. No bigint payment column and no `pending_amount_cents` are introduced; `pending_amount` remains authoritative. |
| Facts | `Payment` is immutable and has `id, loanId, amount, principalApplied, interestApplied, paymentDate, methodId, collectorId?, createdByUserId, status, idempotencyKey?, idempotencyFingerprint?, createdAt`; money satisfies `amount = principalApplied + interestApplied`. `PaymentApplication` has exactly `paymentId, paymentPlanEntryId, amountApplied, pendingBefore, pendingAfter, carriedForwardAmount (default 0.00), carriedToPlanEntryId?, createdAt`. Principal/interest remain Payment-level authority. |
| Annulment/idempotency | `PaymentAnnulment` has `id, paymentId, reason, annulmentDate, createdByUserId, idempotencyKey, idempotencyFingerprint, createdAt`. Unique keys: `Payment.idempotencyKey` (when present), `PaymentAnnulment.idempotencyKey`, one annulment per payment, and one payment-owned customer inflow. Same key plus same fingerprint returns the original response; mismatch is 409. A unique-violation retry reads the committed row and applies the same rule, so concurrent duplicates create one fact. |
| Cash | Add nullable `cash_movements.payment_id UUID` with `ON DELETE RESTRICT`. Add a partial unique index for `concept='CUSTOMER_PAYMENT' AND payment_id IS NOT NULL`, plus checks requiring that concept to be `INFLOW`, linked, positive, and decimal-valid. The existing `reversed_movement_id` links the annulment `REVERSAL`; original cash is never overwritten. The manual endpoint rejects `CUSTOMER_PAYMENT`. |

## Contracts and Roles

| Route | Contract and permission |
|---|---|
| `GET /payments/loans?search&page&pageSize` | Active-loan selector; returns loan/customer, `financialBalance`, active methods, and collector options. `payments.view`. |
| `GET /payments/loans/:loanId` | Read-only context/projection: loan, current positive pending entries, VALID payment history, applications, reconciled balances, eligibility, and combined rows. `payments.view` plus existing loan visibility. |
| `POST /payments` | DTO `{loanId, amount, paymentDate, methodId, collectorId?, idempotencyKey}`; response is Payment plus applications, balances, and linked cash id. `payments.create`. |
| `POST /payments/:paymentId/annul` | DTO `{reason, annulmentDate, idempotencyKey}`; response is the original Payment now `ANNULLED`, annulment, reversal, and balances. `payments.annul`. |
| `PUT /payments/loans/:loanId/plan` | DTO `{entries:[{dueDate,pendingAmount}], idempotencyKey}`; replaces current positive pending projection only. `payments.plan.customize`. |

The combined PDF and eligibility are read-only views of the same detail projection (no `payments.export`; PDF uses `payments.view`), with preview in an accessible popup and no mutation. Role matrix: superadmin centrally bypasses; `ADMIN` and `COLLECTION_MANAGER` receive all four permissions; `COLLECTOR` receives none. A collector may only be an optional active Payment reference selected by an authorized registrar.

## Transaction and Invariant Design

Create locks in this order: idempotency row/key, loan, opening/reference rows, then all current plan rows `(dueDate, sequence, id)`. Validate opening/start-date ≤ paymentDate ≤ today, active method/collector, loan ACTIVE, positive amount ≤ `financialBalance`, and exact decimal arithmetic. Allocate principal before interest, chronologically; underpayment stays on the same obligation, permitted remainder carries forward, and every update creates an application. Enforce `amount=principalApplied+interestApplied`, `financialBalance=Loan.totalAmount-SUM(VALID amount)`, `outstandingPrincipal=Loan.principal-SUM(VALID principalApplied)`, `realizedInterest=SUM(VALID interestApplied)`, and `SUM(VALID amount)+SUM(positive pending)=Loan.totalAmount`. Insert Payment, applications, plan updates, and linked inflow atomically.

Annul locks key, loan, payment, plan rows, and linked cash in that order; rechecks `VALID` and last-valid chronology `(paymentDate DESC, createdAt DESC, id)`, then inserts one annulment/reversal, restores positive pending rows chronologically, and reactivates a cancelled loan only when restored balance requires it. Customize locks key, loan, and current plan rows; rejects stale fingerprint, paid-entry changes, dates before `loan.startDate`, or a total unlike current `financialBalance`. All stale, lock, idempotency, and invariant failures are 409 with rollback. Paid history remains stable without snapshots/version tables; cancellation/reactivation is a current projection transition.

## Data Flow, Files, and Tests

`Controller → use case → pure decimal allocator/projection → ports → transaction manager`; the PDF adapter consumes that projection, never a second query model. Create `backend/src/{domain,application}/payment/*`, TypeORM entities/repositories/migrations later, payment presentation DTO/controller/module, and frontend application/API/page/report adapters; modify only existing loan/cash/security composition while preserving all current routes and actions. Tests cover equations, chronology/statuses, locks/races/idempotent replay, cash checks/manual rejection, role denial, selector/search/page, plan reinsertion, popup/PDF ordering, and existing loan/cash non-regression.

## Threat Matrix

N/A — no shell, subprocess, VCS automation, executable classification, or process-integration boundary.

## Migration / Rollout

No migration is performed now. Later changes are additive, use restrictive foreign keys/checks/indexes, and may feature-gate payment routes while retaining existing loan, opening, method, cash, disbursement, and manual reversal behavior.

## Open Questions

None.
