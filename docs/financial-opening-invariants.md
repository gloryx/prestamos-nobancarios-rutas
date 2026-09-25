# Financial opening invariants

The financial opening is the immutable zero point for the business ledger. It records the starting date, available cash, pending principal portfolio, initial uncollectible capital, and historical seed capital as information. It does not perform calculations or create loan, payment, or schedule records.

- Active portfolio means pending principal only; interest and fees are not principal.
- Uncollectible principal is excluded from active portfolio and available cash.
- Available cash is the opening available amount plus principal collected, external income, and other explicitly recorded cash inflows, minus new loan principal, expenses, and other explicitly recorded cash outflows.
- Historical seed capital is informational and must not be counted as a new cash inflow when the opening is posted.
- A new loan increases active pending principal and decreases available cash by its principal.
- A payment allocates principal and interest explicitly. Principal reduces pending principal and increases cash; interest is income and never principal profit.
- External income increases cash; expenses decrease cash. Reversals must reverse the original allocation exactly once.
- A transition from `ACTIVE` to `UNCOLLECTIBLE` removes principal from active portfolio without creating cash or profit.
- Refinancing transfers the outstanding principal from the old obligation to the new one; it must not duplicate principal or cash.
- Current formulas must use opening values plus posted, non-reversed ledger movements, without double counting any movement.
- These rules do not depend on `PaymentSchedule`; schedule projections are not posted financial truth.
