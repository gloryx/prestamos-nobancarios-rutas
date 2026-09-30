import type { paymentApi, PaymentContext, PendingPaymentEntry, PlanBaseline } from '../../infrastructure/api/payment.api';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { moneyFromCents, parseMoneyCents } from '../../shared/utils/money';

export type PaymentTimelineRow =
  | { kind: 'PAYMENT'; id: string; date: string; amount: string }
  | { kind: 'PLAN_ENTRY'; id: string; date: string; amount: string };
export type PlanDraftEntry = { key: string; id: string | null; dueDate: string; pendingAmount: string };

export function localDateOnly(date = new Date()): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

export function paymentTimeline(context: PaymentContext): PaymentTimelineRow[] {
  const rows: PaymentTimelineRow[] = [
    ...context.validPayments.filter((payment) => payment.status === 'VALID').map((payment) => ({ kind: 'PAYMENT' as const, id: payment.id, date: payment.paymentDate, amount: payment.amount })),
    ...context.combinedPlan.filter((entry) => (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n).map((entry) => ({ kind: 'PLAN_ENTRY' as const, id: entry.id, date: entry.dueDate, amount: entry.pendingAmount })),
  ];
  return rows.sort((a, b) => a.date.localeCompare(b.date) || (a.kind === b.kind ? a.id.localeCompare(b.id) : a.kind === 'PAYMENT' ? -1 : 1));
}

export function planDraftFromEntries(entries: PendingPaymentEntry[]): PlanDraftEntry[] {
  return entries.filter((entry) => (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n)
    .map((entry) => ({ key: entry.id, id: entry.id, dueDate: entry.dueDate, pendingAmount: entry.pendingAmount }));
}

export function planBaselineFromContext(context: PaymentContext): PlanBaseline {
  return Object.freeze({ financialBalance: context.balances.financialBalance, entries: Object.freeze(context.combinedPlan
    .filter((entry) => (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n)
    .map(({ id, dueDate, pendingAmount }) => Object.freeze({ id, dueDate, pendingAmount }))) });
}

export function orderedPlanDraft(draft: PlanDraftEntry[]): PlanDraftEntry[] {
  return [...draft].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.key.localeCompare(b.key));
}

export function reviewPlanDraft(balance: string, draft: PlanDraftEntry[]) {
  const balanceCents = parseMoneyCents(balance);
  let distributedCents = 0n;
  const entries = orderedPlanDraft(draft).map(({ id, dueDate, pendingAmount }) => {
    const cents = parseMoneyCents(pendingAmount);
    if (cents !== null && cents > 0n) distributedCents += cents;
    return { id, dueDate, pendingAmount: cents === null ? '' : moneyFromCents(cents) };
  });
  const valid = draft.length > 0 && balanceCents !== null && balanceCents > 0n && draft.every((entry) =>
    /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) && formatDateOnlyForDisplay(entry.dueDate) !== '—'
    && (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n);
  const differenceCents = balanceCents === null ? null : balanceCents - distributedCents;
  return { distributedCents, differenceCents, entries, canSave: valid && differenceCents === 0n };
}

export function planSaveAttempt(previous: { fingerprint: string; key: string } | null, loanId: string, base: PlanBaseline, entries: ReturnType<typeof reviewPlanDraft>['entries'], generateKey = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify({ loanId, base, entries });
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: generateKey() };
}

export class PlanRefreshError extends Error {
  constructor(cause: unknown) {
    super(cause instanceof Error ? cause.message : 'No se pudo actualizar el contexto.');
    this.name = 'PlanRefreshError';
  }
}

export async function persistPlanAndRefresh(loanId: string, base: PlanBaseline, entries: ReturnType<typeof reviewPlanDraft>['entries'], key: string, api: Pick<typeof paymentApi, 'customizePlan' | 'context'>): Promise<PaymentContext> {
  await api.customizePlan(loanId, base, entries, key);
  try { return await api.context(loanId); }
  catch (cause) { throw new PlanRefreshError(cause); }
}
