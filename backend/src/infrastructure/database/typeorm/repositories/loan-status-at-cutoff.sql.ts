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
      AND h.refinancing_id IS NULL
      AND NOT (h.to_status = 'REFINANCED' AND EXISTS (
        SELECT 1 FROM loan_refinancings historical_refinancing WHERE historical_refinancing.origin_loan_id = h.loan_id))
      AND NOT EXISTS (SELECT 1 FROM payment_annulments correction
        WHERE correction.annulment_type = 'DATA_CORRECTION'
          AND (correction.payment_id = h.payment_id OR correction.id = h.payment_annulment_id))
    UNION ALL
    SELECT r.origin_loan_id, r.refinancing_date AS effective_date, 20 AS priority, 0 AS event_sequence,
      'REFINANCED'::text AS status
    FROM loan_refinancings r
    LEFT JOIN loan_refinancing_annulments annulment ON annulment.refinancing_id = r.id
    WHERE r.refinancing_date <= ${cutoff}::date
      AND ((r.status = 'CONFIRMED' AND annulment.refinancing_id IS NULL)
        OR (r.status = 'ANNULLED' AND annulment.annulment_type = 'CASH_REFUND'
          AND ${cutoff}::date < annulment.effective_date))
    UNION ALL
    SELECT r.origin_loan_id, annulment.effective_date, 40 AS priority, 0 AS event_sequence,
      'ACTIVE'::text AS status
    FROM loan_refinancings r
    JOIN loan_refinancing_annulments annulment ON annulment.refinancing_id = r.id
    WHERE r.status = 'ANNULLED' AND annulment.annulment_type = 'CASH_REFUND'
      AND annulment.effective_date <= ${cutoff}::date
    UNION ALL
    SELECT r.new_loan_id,
      CASE WHEN annulment.annulment_type = 'DATA_CORRECTION' THEN r.refinancing_date ELSE annulment.effective_date END,
      40 AS priority, 0 AS event_sequence, 'ANNULLED'::text AS status
    FROM loan_refinancings r
    JOIN loan_refinancing_annulments annulment ON annulment.refinancing_id = r.id
    WHERE r.status = 'ANNULLED'
      AND r.refinancing_date <= ${cutoff}::date
      AND (annulment.annulment_type = 'DATA_CORRECTION'
        OR (annulment.annulment_type = 'CASH_REFUND' AND annulment.effective_date <= ${cutoff}::date))
  ), status_at_cutoff AS (
    SELECT DISTINCT ON (candidate.loan_id) candidate.loan_id, candidate.status, candidate.effective_date
    FROM status_candidates candidate
    ORDER BY candidate.loan_id, candidate.effective_date DESC, candidate.priority DESC, candidate.event_sequence DESC
  )`;
}
