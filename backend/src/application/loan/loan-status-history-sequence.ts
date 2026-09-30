export class LoanStatusHistorySequenceError extends Error {
  constructor() { super('The loan status history sequence is unavailable.'); }
}

// Transition callers must hold the Loan FOR UPDATE lock in their transaction.
export async function getNextLoanStatusEventSequence(manager: { query(sql: string, parameters: unknown[]): Promise<unknown[]> }, loanId: string): Promise<number> {
  const [row] = await manager.query('SELECT MAX(event_sequence) AS "maxSequence" FROM loan_status_history WHERE loan_id = $1', [loanId]);
  const maximum: unknown = (row as { maxSequence?: unknown } | undefined)?.maxSequence;
  if (maximum === null) return 1;
  if (typeof maximum !== 'number' || !Number.isSafeInteger(maximum) || maximum < 1 || maximum >= 2147483647) {
    throw new LoanStatusHistorySequenceError();
  }
  return maximum + 1;
}
