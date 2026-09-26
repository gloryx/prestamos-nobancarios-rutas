# Proposal: Add Payments Domain

## Intent
Introduce auditable Payments so customer payments, allocation, cash, annulment, refinancing eligibility, and current-plan state remain consistent. Facts are immutable per delivery; `PaymentPlanEntry` remains the mutable current pending plan, with targeted `PaymentApplication` audit only.

## Scope

### In Scope
- Register with capital-first chronological allocation, underpayment carry-forward, cross-obligation overpayment, and final partial entry.
- Record `PaymentApplication` audit rows and one atomic `CUSTOMER_PAYMENT` movement.
- Support last-valid-payment annulment, compensating cash, current-plan reinsertion, and cancelled-Loan reactivation.
- Support plan customization, active-only selection, payment-based refinancing eligibility, combined projection, and PDF preview.
- Expose permissioned API/UI flows for `ADMIN` and `COLLECTION_MANAGER`; collector remains distinct from the registering user.

### Out of Scope
- Production implementation, migrations, database changes, or generic cash-endpoint reuse in this phase.
- Full plan version history, original snapshots, duplicate historical plans, fact editing/deletion, arbitrary annulments, generic refinancing execution, or unrelated Loan/Cash redesign.

## Capabilities

### New Capabilities
- `payments`: immutable lifecycle, applications, annulment, permissions, cash linkage, and projections.
- `adaptive-payment-plans`: mutable pending-plan rules and combined projection/PDF.

### Modified Capabilities
- `loans`: active-only selection, cancelled-loan reactivation, plan customization, and refinancing eligibility.
- `cash-movements`: linked customer-payment facts and compensating annulments without weakening manual boundaries.

## Approach
Payments owns facts, applications, annulments, and orchestration. Each operation uses one transaction, deterministic Loan/plan locks, restrictive foreign keys, bigint-cent validation, and idempotency fingerprints. Capital is applied first chronologically; remaining balance follows the closed rules. `PaymentPlanEntry` may be updated as the current pending plan, but every allocation has targeted `PaymentApplication` audit; unaudited decrement is rejected. No plan-version table or snapshot is introduced. Invariants enforce fact, current-plan, and cash consistency.

Later implementation uses additive migrations for payment facts, applications, annulments, payment-to-cash linkage, indexes, and constraints; reconcile legacy current plans without rewriting facts. Preserve APIs. UI reuses centralized authorization, selectors, accessible actions, and formatters; PDF shows the combined current-plan projection.

## Affected Areas
| Area | Impact |
|---|---|
| Backend | Payment ports, orchestration, adapters, API |
| Loan/cash | Current-plan state, linked movements, selectors |
| Frontend/PDF | Registration, history, annulment, preview |

## Risks
| Risk | Mitigation |
|---|---|
| Concurrent races | Stable locks, invariant checks, idempotency |
| Legacy ambiguity | Reconciliation and projection tests |
| Permission/cash regression | Central guard and non-regression tests |

## Rollback Plan
Feature-flag routes/UI, stop registrations, retain immutable facts and applications, and disable payment-driven current-plan updates while preserving Loan/Cash reads. Compensating transactions—not deletes or snapshots—restore state.

## Success Criteria
- [ ] Every valid Payment has audited applications and one linked atomic cash effect.
- [ ] Allocation, annulment, reactivation, permissions, projection, and PDF rules pass tests.
- [ ] Existing Loans, Cash, openings, methods, routes, and capabilities remain runnable.
