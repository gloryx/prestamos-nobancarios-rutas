# Delta for Cash Movements

## ADDED Requirements

### Requirement: Payment cash identity and reversal
Every `VALID` Payment MUST have exactly one `CUSTOMER_PAYMENT` inflow with the same `NUMERIC(18,2)` amount, non-null `cash_movements.payment_id` foreign-keyed to Payment, and uniqueness among payment inflows. No generic/manual `CUSTOMER_PAYMENT` is allowed. Annulment MUST create exactly one linked `REVERSAL` through the existing reversal linkage, using the backend-set current operation date, without deleting or overwriting the original.

#### Scenario: Atomic identity
- GIVEN a valid payment registration
- WHEN its transaction commits
- THEN one unique linked inflow exists and no payment can commit without it

#### Scenario: Atomic compensation
- GIVEN the last valid payment is annulled
- WHEN compensation commits
- THEN one linked reversal reconciles cash and the original inflow remains immutable

### Requirement: Preserve cash boundaries and opening
Existing manual cash concepts, FinancialOpening, current totals, PaymentMethods, and reversal rules MUST remain available. Customer-payment inflows MAY be created only by the Payment workflow and MUST respect opening/date validation.

#### Scenario: Reject manual customer payment
- GIVEN a caller uses the generic manual cash endpoint with `CUSTOMER_PAYMENT`
- WHEN the request is submitted
- THEN it is rejected and existing manual cash actions remain unchanged

#### Scenario: Preserve supporting catalogs
- GIVEN existing opening, payment-method, loan-disbursement, and manual reversal workflows
- WHEN Payments is enabled
- THEN each remains independently runnable with no duplicate or double-counted movement
