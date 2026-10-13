# Post-payment chronological consolidation

`consolidatePlanAfterPayment` calculates, but does not persist, how overdue positive obligations move into the first payable obligation after a payment's effective date.

## Quick path

1. Apply real payment cash to the financial balance and plan first.
2. Pass that post-payment plan and its exact canonical balance to the function.
3. Persist the returned mutations and traces atomically only after a separate integration increment is approved.

## Contract

| Topic | Rule |
| --- | --- |
| Trigger | Only `PAYMENT` is accepted; financial closing and refinancing fail closed. |
| Sources | Every positive obligation dated on or before the effective payment date. |
| Target | The first positive obligation strictly after that date, ordered by date, sequence, then ID. |
| Conservation | Sources become zero and their exact sum is added to the target. No cash or payment application is created. |
| Identity | Entry IDs, dates, sequences, and history remain unchanged. |
| Reconciliation | The input plan must equal the canonical financial balance exactly before any result is returned. |
| No target | Return an unchanged plan. Never invent an obligation. |
| Trace | Return one source-to-target trace for every moved amount. |
| Annulment | Reverse the target mutation first, then restore every source from its trace, in the same transaction and only if persisted amounts still match. |

## Lifecycle boundaries

| Case | Boundary |
| --- | --- |
| Same-date obligations | They are sources because their date is equal to the effective payment date; sequence and ID make their traces deterministic. |
| Historical payments | Use the payment's effective date, never the current date or insertion timestamp. |
| Financial closing | This calculation does not authorize, reopen, or rewrite a close. A future integration must run within the payment transaction and enforce the existing closing policy first. |
| Refinancing | Do not consolidate across replaced and replacement plans. A future integration must either consolidate the source loan before replacement or skip it according to an explicit refinancing rule. |
| Annulment | Exact persisted traces are required. Recomputing from the current plan is unsafe because later payments may have changed the target. |

## Increment boundary

Increment B.1 adds persistence only. It does not change payment registration, annulment, reports, or frontend projections. The current `payment_applications` source-to-target fields remain exclusive to financial payment application and cannot represent several non-cash consolidation traces.

## Persistence contract

| Structure | Responsibility |
| --- | --- |
| `payment_plan_consolidations` | One immutable consolidation header per real payment, including target and payment snapshots. |
| `payment_plan_consolidation_sources` | Ordered immutable source installments with date, sequence, and amount snapshots. |
| `payment_plan_consolidation_reversals` | One immutable reversal fact linked to the annulment of the same payment. |

The database rejects cross-loan relationships, incomplete source totals, snapshot mismatches, duplicate payment consolidations, mismatched annulments, updates, and deletes. Existing payments are not backfilled or inferred from the current mutable plan.

## Approved future policy

- Annulments will be strict LIFO and will not replay later payments automatically.
- Reversal will restore the exact original amounts and dates; it will fail rather than redistribute into a different obligation.
- Financial-close and dependent-operation guards remain authoritative.
- Consolidation and reversal history may be exposed by a later API increment.
- Loan #4764 requires a separately authorized historical correction and is not changed by this schema.

No operational writer or reader uses these tables in B.1. Functional activation requires explicit B.2 authorization.
