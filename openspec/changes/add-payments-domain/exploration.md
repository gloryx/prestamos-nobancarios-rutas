## Exploration: add-payments-domain

### Current State

The repository has an additive Loans domain and a real cash ledger, but no Payments domain. Loans persist `loans`, `loan_disbursements`, and positive `payment_plan_entries`; the only current plan mutation is creation. Loan creation is an application-level transaction that inserts the loan, plan, disbursement, and principal-only `LOAN_DISBURSEMENT` cash movement, with idempotency and restrictive foreign keys.

Cash movements already reserve `CUSTOMER_PAYMENT` and `REVERSAL` concepts, but manual cash movement creation permits only capital contribution, capital withdrawal, external income, and operating expense. Cash reversal is deliberately limited to manual concepts. Therefore a customer payment cannot safely be created through the generic cash endpoint without bypassing an existing boundary.

The requested module must be additive and must preserve existing Loans, Cash Movements, Financial Opening, Payment Methods, authentication, and current frontend capabilities. Clean Architecture requires payment rules and ports to remain framework-independent, with TypeORM/PostgreSQL adapters and HTTP/UI concerns outside the inner layers. The current `openspec/config.yaml` still states “SDD initialization only; do not implement Payments during init”; this is historical initialization context and must not be treated as permission to skip exploration or reinterpret the explicitly requested change. This phase makes no production, migration, or database changes.

### Affected Areas

- `backend/src/domain/loan/` and `backend/src/application/loan/loan.use-case.ts` — payment allocation will consume and mutate loan plan state, including loan status and pending totals.
- `backend/src/infrastructure/database/typeorm/migrations/1761300000000-create-loans.ts` — current schema has no payment facts, allocations, annulments, or payment-to-cash linkage; future schema work must be additive and use restrictive foreign keys.
- `backend/src/infrastructure/database/typeorm/entities/loan.orm-entities.ts` — current ORM model exposes only positive `pending_amount`; it does not model paid amounts, allocation history, or plan adjustment history.
- `backend/src/application/cash-movement/cash-movement.use-cases.ts` and `backend/src/infrastructure/database/typeorm/repositories/cash-movement.typeorm-repository.ts` — payment-created `CUSTOMER_PAYMENT` inflows and payment annulments need a dedicated atomic boundary, not the manual-only endpoint or manual-only reversal path.
- `backend/src/presentation/cash-movement/cash-movement.controller.ts` and `backend/src/shared/constants/security.ts` — existing permissions and endpoints must remain intact while payment permissions are registered centrally and enforced by the existing superadmin-aware guard.
- `backend/src/presentation/loan/loan.controller.ts` and `backend/src/app.module.ts` — payment transport and composition wiring will need to reference loan/payment/cash ports without making controllers access persistence directly.
- `frontend/src/domain/entities/loan.ts`, `frontend/src/infrastructure/api/loan.api.ts`, and `frontend/src/presentation/pages/LoanDetailPage.tsx` — payment history, outstanding plan state, registration, annulment, and any receipt/report actions need explicit contracts and permission-gated presentation.
- `frontend/src/presentation/navigation/navigationConfig.ts`, `frontend/src/presentation/routes/AppRouter.tsx`, `frontend/src/presentation/helpers/permission-matrix.ts`, and `frontend/src/presentation/components/TableActions.tsx` — new navigation and table actions must reuse centralized permission checks, compact accessible actions, and the established responsive behavior.
- `backend/src/infrastructure/database/typeorm/migrations/1761100000000-create-financial-openings.ts` and `backend/src/application/financial-opening/financial-opening.use-cases.ts` — payment dates and cash effects must respect the configured opening date and the one-time financial-opening invariant.

### Evidence and Reuse Opportunities

- Reuse the loan application transaction pattern, bigint-cent validation, idempotency fingerprinting, and `TransactionalCashMovementRecorder` concept as the foundation for atomic payment workflows.
- Reuse `PaymentMethod` active-reference validation, `FinancialOpening` date gating, restrictive `ON DELETE RESTRICT` relationships, and the centralized `RequirePermissions`/`PermissionGuard` path.
- Reuse the frontend `apiClient`, `useAuth().can`, `TableActions`, `LoanPaymentPlanTable`, money/date formatters, toast provider, and existing PDF service conventions rather than creating parallel technical infrastructure.
- Preserve the existing cash ledger as the source of cash facts. A payment record and its cash movement should be linked, not duplicated as unrelated manual records.

### Approaches

1. **Immutable payment facts with allocation records and atomic application workflow** — create a payment header, one or more payment-to-plan allocations, and a linked `CUSTOMER_PAYMENT` cash movement in one transaction; represent annulment with an explicit payment annulment/reversal fact and compensating cash movement rather than deleting or overwriting history.
   - Pros: preserves auditability, supports partial/multi-installment payments, makes idempotency and annulment explicit, and keeps cash and receivable state consistent.
   - Cons: requires a new schema model, row-locking protocol, allocation rules, and clear reporting semantics before implementation.
   - Effort: High

2. **Directly decrement `payment_plan_entries.pending_amount` and reuse generic cash movement reversal** — write the payment amount directly to the schedule and create a customer cash movement through existing generic infrastructure.
   - Pros: smaller initial surface area.
   - Cons: destroys allocation/audit history, cannot safely explain partial or cross-entry applications, conflicts with manual-only reversal rules, creates race conditions without a dedicated lock protocol, and makes annulment reconstruction unreliable.
   - Effort: Medium initially, High long-term risk

### Recommendation

Proceed to proposal with Approach 1. Define Payments as the owner of payment facts, allocations, annulments, and the orchestration of linked cash effects; do not make Payments a shortcut for refinancing or a generic cash-entry screen. Keep `PaymentPlanEntry` as the schedule projection only if the proposal explicitly defines how its pending state is derived or atomically maintained from allocation facts. Every mutation that can affect a loan, its plan, or cash must execute in one database transaction with deterministic row locks and idempotency.

The proposal must resolve whether the first slice supports only allocation to existing plan entries or also adaptive plan mutation (new installments, rescheduling, overpayments, and unapplied balances). It must also define the annulment policy, payment-date constraints, allocation order, rounding rules, collector/ownership scope, receipt/PDF requirements, and whether existing cash-movement list/detail responses expose payment links. These are blocking domain decisions, not implementation details.

### Contradictions, Hidden Dependencies, and Risks

- `ARCHITECTURE.md` says payment rules are future scope, while the user has now explicitly requested the named Payments change; the future-scope note should be updated only in a later approved phase, not silently ignored.
- `openspec/config.yaml` describes initialization-only scope although the requested workflow is a full SDD cycle for a named change; downstream proposal/spec phases must reconcile this configuration wording without changing production behavior in exploration.
- `payment_plan_entries.pending_amount` is positive and directly mutable in the current schema; direct decrementing would lose immutable financial history and requires concurrency protection.
- The existing cash reversal use case rejects `CUSTOMER_PAYMENT`; payment annulment cannot be implemented by calling the current manual reversal endpoint.
- A payment can race with another payment or loan-status transition unless the transaction locks the loan and relevant plan rows in a stable order and verifies remaining balance under lock.
- Idempotency must cover payment registration and annulment independently, with payload fingerprints and uniqueness constraints that prevent the same key from representing different financial facts.
- `FinancialOpening` currently gates cash and loan dates; the payment date, annulment date, and historical payment policy need explicit rules, especially if payments may be backdated.
- Existing `currentAvailable` cash summary aggregates movements globally and does not yet distinguish payment-linked records; projections and reversals must avoid double counting.
- Dynamic RBAC has no Payments permissions today. New codes must be registered in the shared permission catalog, shown by the existing role matrix, guarded on the backend, and bypassed only through the centralized `isSuperAdmin` path.
- Collector ownership/scoping is not established for Loans or Payments. Granting collectors payment access without a resource-scoped policy would violate the architecture note and create an authorization gap.
- The working tree contains unrelated uncommitted Loan, Cash Movement, frontend, documentation, and OpenSpec changes. Later phases must preserve them and avoid treating them as clean baseline files.

### Unresolved Decisions for Proposal

1. What is the first supported payment lifecycle: register only, register plus annul, or register plus edit/reallocation? Financial history should favor register plus explicit annulment.
2. Can one payment allocate across multiple plan entries, and what deterministic order applies when the caller omits allocations (oldest due, sequence, or explicit only)?
3. Are overpayments rejected, stored as unapplied credit, or applied to future entries? Is payment amount required to equal the allocation total?
4. Is the schedule adaptively mutable after payment, and if so, which operations are allowed without introducing refinancing semantics?
5. Must payment dates be on/after the financial opening and on/before today, or can an authorized actor record historical collections with an audit reason?
6. Which payment permissions are required for view, create/register, annul, export/receipt, and collector-scoped access?
7. Is a payment receipt/PDF part of this change, and should the cash ledger expose linked payment identifiers and customer/loan context?
8. Which aggregate is authoritative for loan balance: maintained `pending_amount`, allocation sums, or a rebuilt projection, and how will legacy/current rows be reconciled?
9. What database migration policy is authorized in the later implementation phase, given the current instruction that phases 1–6 must not modify migrations or schema?

### Ready for Proposal

No — the repository evidence is sufficient to frame the change, but proposal work should explicitly record decisions for lifecycle, allocation, adaptive schedule behavior, date policy, RBAC/collector scope, receipt/report scope, and the authoritative balance model. The recommended safe direction is immutable payment facts plus allocations and atomic linked cash movements; the direct-decrement shortcut should be rejected.
