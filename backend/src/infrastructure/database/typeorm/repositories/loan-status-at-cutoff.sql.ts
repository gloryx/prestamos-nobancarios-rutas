export function loanStatusAtCutoffCtes(cutoff: string): string {
  return `status_candidates AS (
    SELECT l.id AS loan_id, l.start_date AS effective_date, 10 AS priority, 0 AS event_sequence, 'ACTIVE'::text AS status
    FROM loans l WHERE l.start_date <= ${cutoff}::date
    UNION ALL
    SELECT h.loan_id, (h.changed_at AT TIME ZONE 'America/Costa_Rica')::date AS effective_date,
      30 AS priority, h.event_sequence, h.to_status::text AS status
    FROM loan_status_history h
    WHERE h.event_kind = 'TRANSITION'
      AND (h.changed_at AT TIME ZONE 'America/Costa_Rica')::date <= ${cutoff}::date
      AND NOT EXISTS (SELECT 1 FROM payment_annulments correction
        WHERE correction.annulment_type = 'DATA_CORRECTION'
          AND (correction.payment_id = h.payment_id OR correction.id = h.payment_annulment_id))
    UNION ALL
    SELECT r.origin_loan_id, r.refinancing_date AS effective_date, 20 AS priority, 0 AS event_sequence,
      'REFINANCED'::text AS status
    FROM loan_refinancings r WHERE r.refinancing_date <= ${cutoff}::date
  ), status_at_cutoff AS (
    SELECT DISTINCT ON (candidate.loan_id) candidate.loan_id, candidate.status, candidate.effective_date
    FROM status_candidates candidate
    ORDER BY candidate.loan_id, candidate.effective_date DESC, candidate.priority DESC, candidate.event_sequence DESC
  )`;
}
