import { applyPaymentPlanDraft, type PaymentPlanDraftEntry } from '../src/application/payment/payment-plan-draft';
import { PaymentConflictError, PaymentValidationError } from '../src/application/payment/payment.use-case';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const ZERO = '33333333-3333-4333-8333-333333333333';
const FOREIGN = '44444444-4444-4444-8444-444444444444';
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
type Row = { id: string; loanId: string; dueDate: string; sequence: number; pendingAmount: string };
const row = (id: string, sequence: number, dueDate: string, pendingAmount: string, loanId = 'loan'): Row => ({ id, loanId, sequence, dueDate, pendingAmount });
const initial = () => [row(A, 3, '2026-02-02', '400.00'), row(B, 7, '2026-03-02', '500.00'), row(ZERO, 9, '2026-01-15', '0.00'), row(FOREIGN, 30, '2026-02-02', '1.00', 'other')];
const draft = (): PaymentPlanDraftEntry[] => [{ id: A, dueDate: '2026-04-01', pendingAmount: '400.00' }, { id: B, dueDate: '2026-05-01', pendingAmount: '500.00' }];

function executor() {
  const rows = initial();
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[]) => {
    calls.push({ sql, params });
    if (sql.startsWith('SELECT id, due_date::text')) return rows.filter((item) => item.loanId === params[0] && (!sql.includes('pending_amount > 0') || cents(item.pendingAmount) > 0n))
      .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.sequence - right.sequence || left.id.localeCompare(right.id)).map((item) => ({ ...item }));
    if (sql.startsWith('SELECT COALESCE(SUM(pending_amount)')) return [{ pendingAmount: money(rows.filter((item) => item.loanId === params[0] && cents(item.pendingAmount) > 0n).reduce((sum, item) => sum + cents(item.pendingAmount), 0n)) }];
    if (sql.startsWith('INSERT INTO payment_plan_entries')) { rows.push(row(`new-${params[1]}`, params[1] as number, params[2] as string, params[3] as string)); return []; }
    if (sql.startsWith('UPDATE payment_plan_entries SET due_date')) {
      const existing = rows.find((item) => item.id === params[2] && item.loanId === params[3] && cents(item.pendingAmount) > 0n);
      if (!existing) return [[], 0];
      existing.dueDate = params[0] as string; existing.pendingAmount = params[1] as string;
      return [[{ id: existing.id }], 1];
    }
    if (sql.startsWith('UPDATE payment_plan_entries SET pending_amount = 0')) {
      const existing = rows.find((item) => item.id === params[0] && item.loanId === params[1] && cents(item.pendingAmount) > 0n);
      if (!existing) return [[], 0];
      existing.pendingAmount = '0.00'; return [[{ id: existing.id }], 1];
    }
    throw new Error(`Unexpected query: ${sql}`);
  });
  return { rows, calls, query, writes: () => calls.filter(({ sql }) => /^(INSERT|UPDATE|DELETE)\b/.test(sql)) };
}

describe('transaction-scoped ID-safe payment plan draft', () => {
  it('soft-closes every positive row for an empty zero-target draft without touching historical zero rows', async () => {
    const db = executor();
    expect(await applyPaymentPlanDraft(db, 'loan', '2026-01-01', 0n, [])).toEqual([]);
    expect(db.rows.map((item) => item.pendingAmount)).toEqual(['0.00', '0.00', '0.00', '1.00']);
    expect(db.writes()).toHaveLength(2);
    expect(db.writes().every(({ sql }) => sql.startsWith('UPDATE payment_plan_entries SET pending_amount = 0'))).toBe(true);
  });

  it('rejects nonempty zero-target and negative-target drafts before any mutation', async () => {
    for (const [target, entries] of [[0n, draft()], [-1n, []]] as const) {
      const db = executor();
      await expect(applyPaymentPlanDraft(db, 'loan', '2026-01-01', target, entries)).rejects.toBeInstanceOf(PaymentConflictError);
      expect(db.writes()).toEqual([]); expect(db.rows).toEqual(initial());
    }
  });

  it('preserves referenced sequences, assigns consecutive sequences after every historical zero, and soft-closes omissions', async () => {
    const db = executor();
    const final = await applyPaymentPlanDraft(db, 'loan', '2026-01-01', 90000n, [
      { id: null, dueDate: '2026-04-01', pendingAmount: '250.00' },
      { id: null, dueDate: '2026-05-01', pendingAmount: '250.00' },
      { id: A, dueDate: '2026-06-01', pendingAmount: '400.00' },
    ]);
    expect(final.map(({ id, sequence, pendingAmount }) => [id, sequence, pendingAmount])).toEqual([['new-10', 10, '250.00'], ['new-11', 11, '250.00'], [A, 3, '400.00']]);
    expect(db.rows.find((item) => item.id === B)).toEqual({ ...initial()[1], pendingAmount: '0.00' });
    expect(db.rows.find((item) => item.id === ZERO)).toEqual(initial()[2]);
    expect(db.rows.find((item) => item.id === FOREIGN)).toEqual(initial()[3]);
    expect(db.calls[0].sql).toContain('FOR UPDATE');
    expect(db.calls[0].sql).not.toContain('pending_amount > 0');
    expect(db.writes().some(({ sql }) => sql.startsWith('DELETE') || sql.includes('sequence ='))).toBe(false);
  });

  it('uses a caller-provided one-cent-different target without reading or mutating Loan or Payment facts', async () => {
    const db = executor();
    const storedLoan = Object.freeze({ totalAmount: '1000.00', paidAmount: '100.00' });
    const storedLoanBalance = cents(storedLoan.totalAmount) - cents(storedLoan.paidAmount);
    const final = await applyPaymentPlanDraft(db, 'loan', '2026-01-01', storedLoanBalance + 1n, [
      { id: A, dueDate: '2026-04-01', pendingAmount: '400.00' }, { id: B, dueDate: '2026-05-01', pendingAmount: '500.01' },
    ]);
    expect(final.reduce((sum, item) => sum + cents(item.pendingAmount), 0n)).toBe(storedLoanBalance + 1n);
    expect(storedLoan).toEqual({ totalAmount: '1000.00', paidAmount: '100.00' });
    expect(db.calls.every(({ sql }) => !/\b(loans|payments|payment_applications|cash_movements)\b/i.test(sql))).toBe(true);
    expect(db.rows.find((item) => item.id === B)?.pendingAmount).toBe('500.01');
  });

  it.each([
    ['duplicate ID', [{ ...draft()[0] }, { ...draft()[1], id: A }], PaymentValidationError, 'The payment plan entry identifier is invalid or duplicated.'],
    ['foreign ID', [{ ...draft()[0], id: FOREIGN }, draft()[1]], PaymentValidationError, 'The payment plan entry is not an active obligation of this loan.'],
    ['closed ID', [{ ...draft()[0], id: ZERO }, draft()[1]], PaymentValidationError, 'The payment plan entry is not an active obligation of this loan.'],
    ['invalid ID', [{ ...draft()[0], id: 'bad' }, draft()[1]], PaymentValidationError, 'The payment plan entry identifier is invalid or duplicated.'],
    ['missing ID', [{ dueDate: '2026-03-02', pendingAmount: '900.00' } as PaymentPlanDraftEntry], PaymentValidationError, 'El formato del plan está desactualizado. Cada obligación debe indicar su identificador.'],
    ['zero amount', [{ ...draft()[0], pendingAmount: '0.00' }, draft()[1]], PaymentValidationError, 'The payment plan has an invalid date or amount.'],
    ['negative amount', [{ ...draft()[0], pendingAmount: '-1.00' }, draft()[1]], PaymentValidationError, 'The payment plan has an invalid date or amount.'],
    ['invalid amount', [{ ...draft()[0], pendingAmount: '400.001' }, draft()[1]], PaymentValidationError, 'The payment plan has an invalid date or amount.'],
    ['impossible date', [{ ...draft()[0], dueDate: '2026-02-30' }, draft()[1]], PaymentValidationError, 'The payment plan has an invalid date or amount.'],
    ['before start', [{ ...draft()[0], dueDate: '2025-12-31' }, draft()[1]], PaymentValidationError, 'The payment plan has an invalid date or amount.'],
    ['cent mismatch', [{ ...draft()[0], pendingAmount: '400.01' }, draft()[1]], PaymentConflictError, 'The payment plan does not reconcile with the current balance.'],
    ['empty draft', [], PaymentValidationError, 'The payment plan has an invalid date or amount.'],
  ] as const)('rejects %s before any mutation with its original error', async (_, entries, errorType, message) => {
    const db = executor();
    await expect(applyPaymentPlanDraft(db, 'loan', '2026-01-01', 90000n, entries)).rejects.toMatchObject({ message });
    await expect(applyPaymentPlanDraft(executor(), 'loan', '2026-01-01', 90000n, entries)).rejects.toBeInstanceOf(errorType);
    expect(db.writes()).toEqual([]);
    expect(db.rows).toEqual(initial());
  });
});
