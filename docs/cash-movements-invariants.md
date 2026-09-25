# Cash movement invariants

Financial opening is the immutable zero point for real cash. Cash movements are the only recorded real-money entries after that point. Portfolio principal is not cash, and the application must not infer cash movements from a loan, payment, refinancing, installment, schedule, income, expense, or ledger journal that does not exist yet.

Manual concepts are `CAPITAL_CONTRIBUTION` and `EXTERNAL_INCOME` (inflows), and `CAPITAL_WITHDRAWAL` and `OPERATING_EXPENSE` (outflows). The other registered concepts are reserved for future transactional integrations: loan disbursement, customer payment, refinancing new-money disbursement, and reversal. Public manual creation accepts only the first four and derives direction from the concept.

Opening and movement dates are validated together. Available cash is derived as `opening.initialAvailableAmount + SUM(INFLOW) - SUM(OUTFLOW)` and is never stored. Reversals are new opposite movements; the original remains unchanged and only one reversal is allowed. Idempotency keys are server-fingerprinted and unique without exposing the fingerprint.

Operations that do not move real cash, including portfolio analysis and schedule calculations, must not create cash movements. Future source relationships to loans, payments, and refinancings will be added when those modules are implemented; no placeholder foreign keys are intentionally present. Cash movements have no PaymentSchedule dependency.
