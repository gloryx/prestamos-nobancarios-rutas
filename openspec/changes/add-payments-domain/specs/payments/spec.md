# Delta for Payments

## ADDED Requirements

### Requirement: Decimal payment facts and applications
Payment, PaymentApplication, and current `PaymentPlanEntry` money MUST be `NUMERIC(18,2)` decimal strings in persistence and APIs. Bigint cents MAY be used only for exact arithmetic. Payment MUST be immutable and contain `loanId`, `amount`, `principalApplied`, `interestApplied`, `paymentDate`, `methodId`, optional `collectorId`, registering actor, status, and idempotency key. `amount = principalApplied + interestApplied`. Each PaymentApplication MUST contain exactly `paymentId`, `paymentPlanEntryId`, `amountApplied`, `pendingBefore`, `pendingAfter`, `carriedForwardAmount` (default `0.00`), nullable `carriedToPlanEntryId`, and `createdAt`; it MUST NOT require a per-application principal/interest split.

#### Scenario: Register and reconcile
- GIVEN an active loan, active method, valid date, and amount within locked balance
- WHEN an authorized request is posted
- THEN one `VALID` Payment and its applications commit atomically as decimal strings

#### Scenario: Reject invalid or conflicting registration
- GIVEN amount is zero/over-limit, an invariant fails, or an idempotency key has another fingerprint
- WHEN registration is attempted
- THEN no rows change and the API returns a validation or conflict error

### Requirement: Allocation, chronology, and status
The system MUST allocate principal before interest chronologically by `(dueDate, sequence, id)`, carry underpayment on the same obligation, move permitted remainder forward, and reject zero or over-limit amounts. `paymentDate` MUST be on/after `FinancialOpening.openingDate` and `Loan.startDate`, and on/before today. A supplied collector MUST be active and distinct from the registering actor. Status transitions are only `VALID -> ANNULLED`; only the last valid payment ordered by `paymentDate DESC, createdAt DESC, id` MAY transition. Annulment MUST require a reason and MUST NOT accept a client-supplied date: the backend sets `annulledAt` to now, verifies an existing FinancialOpening, verifies the current calendar date is not before `openingDate` or in the future, and creates the reversal with that operation date. The original `paymentDate` MUST remain unchanged. No future or reparented payment chronology MAY be introduced.

#### Scenario: Annul the last payment
- GIVEN the target is the last valid payment
- WHEN an authorized annulment with a required reason is committed
- THEN `annulledAt` is backend-set, the original date is preserved, pending state is restored, and one linked reversal is created atomically

#### Scenario: Reject invalid annulment date context
- GIVEN no FinancialOpening exists, or the current calendar date is before its opening date
- WHEN annulment is attempted
- THEN it is rejected without mutation and a client annulment date is not accepted

### Requirement: Central balances and API contract
The API MUST expose exactly: `GET /payments/loans` (active selector: `search`, `page`, `pageSize`), `GET /payments/loans/:loanId`, `POST /payments`, `POST /payments/:paymentId/annul`, and `PUT /payments/loans/:loanId/plan`. The loan context result contract MUST contain exactly `summary`, `balances`, `combinedPlan`, `firstOperationalRow`, `lastValidPayment`, `refinanceEligibility`, and `preferredMethod`. Projection, PDF preview, and eligibility MUST be fields or actions of that context and existing client-side PDF preview; separate `/context`, `/projection`, `/projection.pdf`, and `/eligibility` routes MUST NOT be required. The create body MUST exclude derived `principalApplied`, `interestApplied`, `status`, `createdBy`, and `cash`; annulment requires `reason`, with date set by the backend.

Idempotent replay with the same fingerprint MUST return the original result; a different fingerprint MUST conflict. `financialBalance = Loan.totalAmount - SUM(VALID Payment.amount)`. `outstandingPrincipal = Loan.principal - SUM(VALID Payment.principalApplied)`. `realizedInterest = SUM(VALID Payment.interestApplied)`. `SUM(VALID Payment.amount) + SUM(positive current pending) = Loan.totalAmount`. Read/PDF uses `payments.view` plus existing loan visibility; there is no export permission. Exactly four permissions exist: `payments.view`, `payments.create`, `payments.annul`, and `payments.plan.customize`. `ADMIN` and `COLLECTION_MANAGER` receive all four; superadmin centrally bypasses all; `COLLECTOR` receives none. Validation/reference errors return 400, authentication 401, authorization 403, missing resources 404, and stale/idempotency/lock/invariant conflicts 409.

#### Scenario: Enforce authorization and read-only access
- GIVEN a Collector or caller without the required permission
- WHEN the caller selects, posts, annuls, customizes, or reads context/PDF preview
- THEN access is forbidden without mutation; a permitted read returns the exact context result contract
