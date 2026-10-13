# Stage 3B frontend integration

The React UI uses the existing Stage 2/3A APIs without inventing joins, balances, filters, or pagination.

## Backend contract boundaries

| Experience | Honest UI behavior |
|---|---|
| Collector capture | Registration fails closed unless assigned-loan detail includes `financialBalance`, `reservedPrecollections`, `operationalBalance`, and `activePaymentMethods`. |
| Precollection detail | The current detail response has no `settlementId`; the dialog states that the settlement relation is unavailable. |
| Global precollections | Date range, collector ID, status, search, and pagination are sent to the server. Payment-method and route controls are omitted because no permitted option source is guaranteed. |
| Settlements | The backend list is unpaginated. Status tabs are explicitly local to the loaded result. Collector/customer display names are not fabricated. |
| Custody | Movement history is unpaginated and unfiltered. No server-filter or paging claim is shown. |
| Delivery and custody forms | Payment-method IDs are entered directly because these roles are not guaranteed catalog access through the current contract. |

## Safety rules

- Custody treatment is always selected explicitly and never inferred from a payment method.
- Mutating actions retain their idempotency key after uncertain failures and disable duplicate submission.
- Future Costa Rica dates are blocked in collector and financial action forms.
- Collector pages expose only self-service actions; administrative review and confirmation remain global and permission-gated.
- No custody screen offers loan disbursement.
