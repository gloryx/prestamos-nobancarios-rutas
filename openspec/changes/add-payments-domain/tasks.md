# Tasks: Add Payments Domain

## Review Workload Forecast

| Field | Value |
|---|---|
| Estimated changed lines | 900–1,300 |
| 400-line budget risk | High |
| Chained PRs recommended | Yes |
| Suggested split | Foundation → workflow → API/read/UI → regression |
| Delivery strategy | exception-ok |
| Chain strategy | single-pr with accepted size:exception |

Decision needed before apply: No — the maintainer explicitly accepted a single PR with `size:exception`.
Chained PRs recommended: Yes
Chain strategy: single-pr with accepted size:exception
400-line budget risk: High

### Suggested Work Units

| Unit | Goal | Focused test command | Runtime harness | Rollback boundary |
|---|---|---|---|---|
| 1 | Facts, constraints, ports | `npm test --prefix backend -- payment` | N/A: no route yet | payment foundation only |
| 2 | Atomic register/annul | same focused backend command | register → replay → annul | payment workflow only |
| 3 | Plan/API/read model | same focused backend command | authorized route scenarios | API/security/read model only |
| 4 | UI/PDF/regressions | `npm test --prefix frontend` + named backend suites | existing and payment PDF previews | UI/report/tests only |

## Phase 1: Foundation

- [x] **1.1 RED — areas:** payment domain/ORM design, cash entity, security catalog. **Deps:** none. **Tests:** `NUMERIC(18,2)` decimal-string persistence/API; bigint cents only at arithmetic boundaries; no bigint money or `pending_amount_cents`; Payment minimum audit fields; PaymentApplication minimum fields; `amount = principalApplied + interestApplied`; `payment_id` FK, partial CUSTOMER_PAYMENT uniqueness, existing reversal linkage; four exact permissions and superadmin/role matrix. **Accept:** unsafe boundaries fail. **Rollback:** tests only.
- [x] **1.2 GREEN — areas:** payment/cash/security adapters. **Deps:** 1.1. **Tests:** 1.1. **Accept:** additive contracts preserve manual CashMovement/reversal, FinancialOpening, PaymentMethods, Loan creation/disbursement, and existing PDF preview; no plan history/versioning. **Rollback:** payment additions/tests only.

## Phase 2: Atomic Workflow

- [x] **2.1 RED — areas:** payment application/transaction ports. **Deps:** 1.2. **Tests:** idempotency replay/mismatch/concurrency; lock order key→loan→opening/reference→plan; opening/date chronology; status transitions; allocation equations, capital-first chronology, carry-forward, final partial, and rollback. **Accept:** each unsafe case is explicit. **Rollback:** tests only.
- [x] **2.2 GREEN — areas:** payment use cases, loan plan, cash adapter. **Deps:** 2.1. **Tests:** focused backend workflow suite. **Accept:** `POST /payments` atomically creates one Payment, minimum applications, and linked CUSTOMER_PAYMENT; `POST /payments/:paymentId/annul` permits only last-valid `VALID→ANNULLED`, reason/idempotency, linked reversal, restoration, and cancellation/reactivation. **Rollback:** workflow files.

## Phase 3: Read/API/UI

- [x] **3.1 RED/GREEN — areas:** plan/projection/PDF application and presentation. **Deps:** 2.2. **Tests:** active-only selector; exact totals/dates; paid-fact preservation; combined projection/PDF/eligibility read-only with `payments.view`; no collector settlement/refinancing. **Accept:** `PUT /payments/loans/:loanId/plan` is stale-safe and creates no plan history/versioning. **Rollback:** plan/read-model/report files.
- [x] **3.2 RED/GREEN — areas:** payment controller/module, frontend API/pages/navigation. **Deps:** 3.1. **Tests:** exact routes `GET /payments/loans`, `GET /payments/loans/:loanId`, `POST /payments`, `POST /payments/:paymentId/annul`, `PUT /payments/loans/:loanId/plan`; only `payments.view`, `payments.create`, `payments.annul`, `payments.plan.customize`; ADMIN/COLLECTION_MANAGER allowed, COLLECTOR denied, superadmin bypass. **Accept:** unauthorized UI actions absent and existing actions remain. **Rollback:** payment API/UI files.

## Phase 4: Regression Verification

- [x] **4.1 — areas:** backend/frontend regression suites. **Deps:** 2.2–3.2. **Tests:** existing Loan creation/disbursement, manual CashMovement/reversal boundaries, FinancialOpening, PaymentMethods, permissions, and existing PDF preview; full tests/lint/build. **Accept:** independent existing workflows pass. **Rollback:** tests/docs only.
- [x] **4.2 — areas:** all changed areas. **Deps:** 4.1. **Tests:** inspect schema/migration diff and unchanged working-tree files. **Accept:** no production code, migrations, or database changes are made in this planning phase; no unrelated files change. **Rollback:** verification artifacts only.
