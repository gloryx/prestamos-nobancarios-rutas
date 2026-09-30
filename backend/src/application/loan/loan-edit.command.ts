import { createHash } from 'node:crypto';
import type { LoanEditBaseline, LoanEditInput, LoanEditPlanEntry } from '../../domain/loan/loan-edit.types';
import { paymentDateOnlyKey } from '../../domain/payment/payment-date-only';

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[\x21-\x7e]{1,128}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

export class LoanEditInputError extends Error {}

function uuid(value: string): string {
  if (typeof value !== 'string' || !UUID.test(value)) throw new LoanEditInputError('El identificador de la edición no es válido.');
  return value.toLowerCase();
}

function cents(value: string, positive = false): bigint {
  if (typeof value !== 'string' || !MONEY.test(value)) throw new LoanEditInputError('El importe de la edición no es válido.');
  const [whole, fraction = ''] = value.split('.');
  const result = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (positive && result === 0n) throw new LoanEditInputError('El importe pendiente debe ser mayor que cero.');
  return result;
}

function day(value: string): string {
  if (typeof value !== 'string' || !DATE.test(value)) throw new LoanEditInputError('La fecha del plan no es válida.');
  const parsed = new Date(`${value}T00:00:00Z`);
  if (!Number.isFinite(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) throw new LoanEditInputError('La fecha del plan no es válida.');
  return value;
}

function observations(value: string | null): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') throw new LoanEditInputError('Las observaciones no son válidas.');
  return value.trim().toUpperCase() || null;
}

type NormalizedRow = Readonly<{ id: string; dueDate: string; pendingAmount: bigint }>;
export type NormalizedLoanEditBaseline = Readonly<{
  interestAmount: bigint;
  paymentFrequencyId: string;
  preferredPaymentMethodId: string;
  observations: string | null;
  financialBalance: bigint;
  plan: readonly NormalizedRow[];
}>;
export type NormalizedLoanEditCommand = Readonly<{
  loanId: string;
  actorId: string;
  idempotencyKey: string;
  baseline: NormalizedLoanEditBaseline;
  changes: Readonly<{
    interestAmount?: bigint;
    paymentFrequencyId?: string;
    preferredPaymentMethodId?: string;
    observations?: string | null;
  }>;
  plan?: readonly Readonly<{ id: string | null; dueDate: string; pendingAmount: bigint }>[];
}>;

function normalizeBaseline(baseline: LoanEditBaseline): NormalizedLoanEditBaseline {
  if (!baseline || !Array.isArray(baseline.plan)) throw new LoanEditInputError('La línea base de la edición no es válida.');
  const seen = new Set<string>();
  const plan = baseline.plan.map((row) => {
    const id = uuid(row.id);
    if (seen.has(id)) throw new LoanEditInputError('El plan contiene identificadores duplicados.');
    seen.add(id);
    return { id, dueDate: day(row.dueDate), pendingAmount: cents(row.pendingAmount, true) };
  });
  return {
    interestAmount: cents(baseline.interestAmount), paymentFrequencyId: uuid(baseline.paymentFrequencyId),
    preferredPaymentMethodId: uuid(baseline.preferredPaymentMethodId), observations: observations(baseline.observations),
    financialBalance: cents(baseline.financialBalance), plan,
  };
}

export function normalizeLoanEditCommand(input: LoanEditInput, loanId: string, actorId: string): NormalizedLoanEditCommand {
  if (!input || typeof input.idempotencyKey !== 'string' || !KEY.test(input.idempotencyKey) || !input.changes || typeof input.changes !== 'object') {
    throw new LoanEditInputError('Los datos de la edición no son válidos.');
  }
  const { changes } = input;
  const requested = (['interestAmount', 'paymentFrequencyId', 'preferredPaymentMethodId', 'observations'] as const)
    .some((field) => changes[field] !== undefined);
  if (!requested) throw new LoanEditInputError('Debe indicar al menos un cambio.');
  const normalizedChanges: NormalizedLoanEditCommand['changes'] = {
    ...(changes.interestAmount !== undefined && { interestAmount: cents(changes.interestAmount) }),
    ...(changes.paymentFrequencyId !== undefined && { paymentFrequencyId: uuid(changes.paymentFrequencyId) }),
    ...(changes.preferredPaymentMethodId !== undefined && { preferredPaymentMethodId: uuid(changes.preferredPaymentMethodId) }),
    ...(changes.observations !== undefined && { observations: observations(changes.observations) }),
  };
  let plan: NormalizedLoanEditCommand['plan'];
  if (input.plan !== undefined) {
    if (!Array.isArray(input.plan)) throw new LoanEditInputError('El plan no es válido.');
    const seen = new Set<string>();
    plan = input.plan.map((row: LoanEditPlanEntry) => {
      if (!row || !Object.prototype.hasOwnProperty.call(row, 'id') || row.id === undefined) throw new LoanEditInputError('El identificador del plan es obligatorio.');
      const id = row.id === null ? null : uuid(row.id);
      if (id !== null) {
        if (seen.has(id)) throw new LoanEditInputError('El plan contiene identificadores duplicados.');
        seen.add(id);
      }
      return { id, dueDate: day(row.dueDate), pendingAmount: cents(row.pendingAmount, true) };
    });
  }
  return { loanId: uuid(loanId), actorId: uuid(actorId), idempotencyKey: input.idempotencyKey,
    baseline: normalizeBaseline(input.baseline), changes: normalizedChanges, ...(plan !== undefined && { plan }) };
}

// Map locked rows without relying on update timestamps or interpreting PostgreSQL dates as UTC days.
export type LoanEditCurrentSnapshot = Omit<LoanEditBaseline, 'plan'> & Readonly<{
  plan: ReadonlyArray<Readonly<{ id: string; dueDate: string | Date; pendingAmount: string }>>;
}>;
export function normalizeLoanEditSnapshot(snapshot: LoanEditCurrentSnapshot): NormalizedLoanEditBaseline {
  if (!snapshot || !Array.isArray(snapshot.plan)) throw new LoanEditInputError('La línea base de la edición no es válida.');
  return normalizeBaseline({ ...snapshot, plan: snapshot.plan
    .filter((row) => cents(row.pendingAmount) > 0n)
    .map((row) => ({ ...row, dueDate: day(paymentDateOnlyKey(row.dueDate)) })) });
}

const compare = (left: string, right: string): number => left < right ? -1 : left > right ? 1 : 0;
const rows = (plan: readonly Readonly<{ id: string | null; dueDate: string; pendingAmount: bigint }>[]) =>
  [...plan].sort((a, b) => a.id === null && b.id === null
    ? compare(a.dueDate, b.dueDate) || compare(a.pendingAmount.toString(), b.pendingAmount.toString())
    : a.id === null ? 1 : b.id === null ? -1 : compare(a.id, b.id))
    .map((row) => [row.id, row.dueDate, row.pendingAmount.toString()]);

function baselineTuple(baseline: NormalizedLoanEditBaseline): unknown[] {
  return [baseline.interestAmount.toString(), baseline.paymentFrequencyId, baseline.preferredPaymentMethodId,
    baseline.observations, baseline.financialBalance.toString(), rows(baseline.plan)];
}

export function loanEditBaselineMatches(baseline: NormalizedLoanEditBaseline, snapshot: LoanEditCurrentSnapshot): boolean {
  try { return JSON.stringify(baselineTuple(baseline)) === JSON.stringify(baselineTuple(normalizeLoanEditSnapshot(snapshot))); }
  catch { return false; }
}

export function loanEditFingerprint(command: NormalizedLoanEditCommand): string {
  const { changes } = command;
  const optional = (value: string | bigint | null | undefined): unknown[] =>
    value === undefined ? [0] : [1, typeof value === 'bigint' ? value.toString() : value];
  const payload = ['loan-edit', command.loanId, command.actorId, baselineTuple(command.baseline),
    [optional(changes.interestAmount), optional(changes.paymentFrequencyId), optional(changes.preferredPaymentMethodId), optional(changes.observations)],
    command.plan === undefined ? [0] : [1, rows(command.plan)]];
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}
