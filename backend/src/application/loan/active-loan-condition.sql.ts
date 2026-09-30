export const ACTIVE_LOAN_OVERDUE_SQL = 'EXISTS (SELECT 1 FROM payment_plan_entries e WHERE e.loan_id = l.id AND e.pending_amount > 0 AND e.due_date < CURRENT_DATE)';
