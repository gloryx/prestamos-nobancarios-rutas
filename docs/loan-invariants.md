# Loan invariants and boundaries

## Quick path

1. A `Loan` owns the principal, interest, total, customer, frequency, and preferred payment method.
2. A `LoanDisbursement` records one immutable principal cash event per loan.
3. `PaymentPlanEntry` stores the ordered current pending schedule; it is not a payment domain.

## Rules

| Topic | Rule |
| --- | --- |
| Schedule | The client may generate an initial plan, but the backend accepts only a final ordered plan and reconciles it exactly to principal plus interest. |
| Cash | Disbursement records an `OUTFLOW` for principal only through the transactional CashMovement application port. No HTTP self-call or raw unmanaged insert is allowed. |
| Methods | Preferred payment method and disbursement payment method are separate fields. |
| Dates | The first automatic due date is one interval after start. Monthly intervals preserve the anchor day at month ends. Due dates must be after the start date. |
| Idempotency | A unique key stores the normalized request fingerprint. The same key and fingerprint returns the existing loan; a different fingerprint returns conflict, including a uniqueness race. |

## Future boundaries

Payment rules belong to a future domain: payments must apply amounts to plan entries atomically, preserve payment idempotency, and derive pending balances from entries and applications. Refinancing is a separate future domain: it must define replacement-loan, balance, and new-money cash rules independently rather than being implemented as a payment shortcut.

No `Payment`, `PaymentApplication`, `Refinancing`, generic status mutation, or payment-count endpoint belongs to this module.
