import { validatePlanCustomization, type PendingPlanEntry } from '../../domain/payment/payment-invariants';
import { PaymentConflictError, PaymentValidationError } from './payment.errors';

export type PaymentPlanDraftEntry = Readonly<{ id: string | null; dueDate: string; pendingAmount: string }>;
export interface PaymentPlanDraftExecutor { query(sql: string, parameters: unknown[]): Promise<unknown[]> }

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const cents = (value: string) => { const [whole, fraction = ''] = value.split('.'); return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0')); };
const money = (value: bigint) => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

// The caller owns the transaction and locks the loan and its plan before invoking this function.
export async function applyPaymentPlanDraft(
  executor: PaymentPlanDraftExecutor, loanId: string, loanStartDate: string,
  targetPendingAmount: bigint, entries: ReadonlyArray<PaymentPlanDraftEntry>,
): Promise<PendingPlanEntry[]> {
  if (!Array.isArray(entries)) throw new PaymentValidationError('The payment plan is invalid.');
  if (entries.some((entry) => !entry || typeof entry !== 'object' || !Object.prototype.hasOwnProperty.call(entry, 'id') || entry.id === undefined)) {
    throw new PaymentValidationError('El formato del plan está desactualizado. Cada obligación debe indicar su identificador.');
  }
  if (targetPendingAmount < 0n || (targetPendingAmount === 0n && entries.length !== 0)) throw new PaymentConflictError('The payment plan does not reconcile with the current balance.');

  type PlanRow = PendingPlanEntry;
  const current = await executor.query(`SELECT id, due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 ORDER BY due_date, sequence, id FOR UPDATE`, [loanId]) as PlanRow[];
  const byId = new Map(current.map((row) => [row.id.toLowerCase(), row]));
  const referenced = new Set<string>();
  for (const entry of entries) {
    if (entry.id === null) continue;
    if (typeof entry.id !== 'string' || !UUID.test(entry.id) || referenced.has(entry.id.toLowerCase())) throw new PaymentValidationError('The payment plan entry identifier is invalid or duplicated.');
    const existing = byId.get(entry.id.toLowerCase());
    if (!existing || !MONEY.test(existing.pendingAmount) || cents(existing.pendingAmount) <= 0n) throw new PaymentValidationError('The payment plan entry is not an active obligation of this loan.');
    referenced.add(entry.id.toLowerCase());
  }
  try { if (targetPendingAmount > 0n) validatePlanCustomization(entries, loanStartDate, money(targetPendingAmount)); }
  catch (error) {
    if (error instanceof Error && error.message === 'plan-total-mismatch') throw new PaymentConflictError('The payment plan does not reconcile with the current balance.');
    if (error instanceof Error && error.message === 'plan-date-sunday') throw new PaymentValidationError('Los domingos no son días de cobro.');
    if (error instanceof Error && error.message === 'plan-date-duplicate') throw new PaymentValidationError('Ya existe una cuota programada para esta fecha.');
    if (error instanceof Error && error.message === 'plan-date-order') throw new PaymentValidationError('La fecha debe ser posterior a la cuota anterior.');
    throw new PaymentValidationError('The payment plan has an invalid date or amount.');
  }
  let nextSequence = current.reduce((max, row) => Math.max(max, row.sequence), 0);
  if (!Number.isSafeInteger(nextSequence) || nextSequence < 0 || nextSequence + entries.filter((entry) => entry.id === null).length > 2147483647) throw new PaymentConflictError('The payment plan sequence is unavailable.');
  const prepared = entries.map((entry) => entry.id === null ? { ...entry, sequence: ++nextSequence } : entry);
  const omitted = current.filter((row) => cents(row.pendingAmount) > 0n && !referenced.has(row.id.toLowerCase()));

  for (const entry of prepared) {
    if (entry.id === null) {
      await executor.query('INSERT INTO payment_plan_entries (loan_id, sequence, due_date, pending_amount) VALUES ($1,$2,$3,$4::numeric(18,2))', [loanId, entry.sequence, entry.dueDate, entry.pendingAmount]);
    } else {
      const updated = await executor.query('UPDATE payment_plan_entries SET due_date = $1, pending_amount = $2::numeric(18,2), updated_at = now() WHERE id = $3 AND loan_id = $4 AND pending_amount > 0 RETURNING id', [entry.dueDate, entry.pendingAmount, entry.id, loanId]);
      if (!Array.isArray(updated[0]) || updated[0].length !== 1 || updated[1] !== 1) throw new PaymentConflictError('The payment plan entry changed during customization.');
    }
  }
  for (const old of omitted) {
    const updated = await executor.query('UPDATE payment_plan_entries SET pending_amount = 0, updated_at = now() WHERE id = $1 AND loan_id = $2 AND pending_amount > 0 RETURNING id', [old.id, loanId]);
    if (!Array.isArray(updated[0]) || updated[0].length !== 1 || updated[1] !== 1) throw new PaymentConflictError('The payment plan entry changed during customization.');
  }
  const [final] = await executor.query(`SELECT COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0`, [loanId]) as Array<{ pendingAmount: string }>;
  if (!final || cents(final.pendingAmount) !== targetPendingAmount) throw new PaymentConflictError('The payment plan does not reconcile with the current balance.');
  const persisted = await executor.query(`SELECT id, due_date::text AS "dueDate", sequence, pending_amount AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = $1 AND pending_amount > 0 ORDER BY due_date, sequence, id`, [loanId]) as PendingPlanEntry[];
  if (persisted.reduce((sum, row) => sum + cents(row.pendingAmount), 0n) !== targetPendingAmount) throw new PaymentConflictError('The payment plan does not reconcile with the current balance.');
  return persisted;
}
