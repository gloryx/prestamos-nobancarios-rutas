# Delta for Adaptive Payment Plans

## ADDED Requirements

### Requirement: Active projection and plan customization
Selectors and `PUT /payments/loans/:loanId/plan` MUST target active loans and current positive pending entries only. Proposed entries MUST use dates `>= Loan.startDate`, including overdue dates, decimal-string amounts summing exactly to current `financialBalance`, and MUST preserve paid facts, applications, and principal invariants. Existing `CHECK pending_amount > 0` MUST be changed additively to allow `pending_amount >= 0`; a `PaymentPlanEntry` referenced by `PaymentApplication` MUST be retained with `pending_amount=0` and excluded from the current positive-pending projection. No plan history/versioning or snapshots MAY be introduced. The operation MUST be idempotent and lock the loan/plan; stale or invariant-invalid requests MUST conflict and change nothing. Collector settlement and refinancing execution MAY NOT be created.

#### Scenario: Customize pending entries
- GIVEN an active loan with paid facts and positive pending entries
- WHEN a permitted request submits valid pending-only entries
- THEN only the current pending projection changes and central equations still hold

#### Scenario: Retain referenced paid entries
- GIVEN a plan entry referenced by PaymentApplication is fully paid
- WHEN its pending amount reaches zero
- THEN the row remains retained at `0.00` and is excluded from the positive pending projection

#### Scenario: Reject paid or stale mutation
- GIVEN a request changes paid history, has the wrong total/date, or uses a stale fingerprint
- WHEN `PUT /payments/loans/:loanId/plan` runs
- THEN it returns validation/conflict and leaves the plan unchanged

### Requirement: Combined context projection and eligibility
`GET /payments/loans/:loanId` MUST provide the read-only combined plan, projection/PDF-preview action, and eligibility result ordered deterministically by obligation date and payment chronology. Eligibility MUST be based on `SUM(VALID Payment.amount) >= Loan.interestAmount` plus reconciled balances. Separate projection, PDF, or eligibility routes MUST NOT be required, and no refinancing execution MAY be exposed.

#### Scenario: Preview without mutation
- GIVEN valid payments and current pending entries
- WHEN the loan context or existing client-side PDF preview is requested with `payments.view` and loan visibility
- THEN each obligation/payment effect appears once with decimal totals and no facts mutate

#### Scenario: Annulled amount is excluded
- GIVEN the threshold was met only by an annulled payment or equations disagree
- WHEN eligibility is evaluated through the context
- THEN the result is ineligible and no refinancing or plan side effect occurs

### Requirement: Annulment reinsertion
After a valid last-payment annulment, referenced entries with restored positive pending state MUST reappear chronologically while retained zero-pending application rows remain excluded. A cancelled loan MUST reactivate when its restored balance requires it; payment history remains immutable and no future or reparented payment chronology is introduced.

#### Scenario: Reinsert restored pending
- GIVEN the last valid payment partly or fully covered an obligation
- WHEN annulment commits
- THEN its applications are reversed, pending is restored, and no historical plan version is created
