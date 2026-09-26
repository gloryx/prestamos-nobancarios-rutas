# Delta for Loans

## ADDED Requirements

### Requirement: Active selection, reactivation, and eligibility
`GET /payments/loans` MUST return active loans only using `search`, `page`, and `pageSize`. `GET /payments/loans/:loanId` MUST return the exact context result contract: `summary`, `balances`, `combinedPlan`, `firstOperationalRow`, `lastValidPayment`, `refinanceEligibility`, and `preferredMethod`, including active method options and eligible collector context. A cancelled loan MAY reactivate only atomically when annulling its last valid payment restores a required balance. Eligibility MUST be read-only and use valid payments and reconciled equations; refinancing execution is out of scope.

#### Scenario: Exclude inactive loans
- GIVEN active, cancelled, and closed loans exist
- WHEN the active selector is requested
- THEN only active loans and their authorized payment context are returned

#### Scenario: Reactivate and evaluate
- GIVEN a cancelled settled loan or insufficient valid payment amount
- WHEN last-payment annulment or context eligibility is requested
- THEN the loan reactivates only in the first case; eligibility never mutates or executes refinancing

### Requirement: Loan non-regression
Existing loan creation, viewing, plan display, disbursement, permissions, active-list behavior, and PDF preview MUST remain independently runnable; payment operations MUST NOT duplicate disbursement or alter unrelated loan workflows.

#### Scenario: Preserve existing loan workflow
- GIVEN Payments is enabled
- WHEN an existing loan is created, disbursed, viewed, or previewed
- THEN the prior capability and result remain available without a duplicate cash/disbursement fact
