import type { paymentApi, PaymentContext, PendingPaymentEntry, PlanBaseline } from '../../infrastructure/api/payment.api';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { moneyFromCents, parseMoneyCents } from '../../shared/utils/money';
import { addInterval, normalizeAutomaticPaymentDates, paymentPlanDateIssue } from '../../application/use-cases/loan-schedule';

export type PaymentTimelineRow =
  | { kind: 'PAYMENT'; id: string; date: string; amount: string }
  | { kind: 'PLAN_ENTRY'; id: string; date: string; amount: string };
export type PlanDraftEntry = { key: string; id: string | null; dueDate: string; pendingAmount: string };
export type PlanFrequency = { intervalUnit: PaymentContext['paymentFrequency']['intervalUnit']; intervalValue: number };
export type AdaptedPlanDraft = { adaptable: true; entries: PlanDraftEntry[] } | { adaptable: false; entries: PlanDraftEntry[]; reason: 'invalid-amount' | 'protected-total' | 'protected-date' | 'missing-frequency' };
export type ChronologicalPaymentAccumulation = {
  lastValidPaymentDate: string;
  receiverEntryId: string | null;
  receiverDate: string | null;
  accumulatedAmount: string;
  components: PendingPaymentEntry[];
};

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

export function paymentSuggestion(context: PaymentContext, planEntryId?: string): { entry: PendingPaymentEntry; amount: string } | null {
  const entry = planEntryId ? context.combinedPlan.find((item) => item.id === planEntryId) ?? null : context.firstOperationalRow;
  const pending = entry ? parseMoneyCents(entry.pendingAmount) : null;
  const balance = parseMoneyCents(context.balances.financialBalance);
  if (!entry || pending === null || pending <= 0n || balance === null || balance <= 0n) return null;
  return { entry, amount: moneyFromCents(pending < balance ? pending : balance) };
}

export function chronologicalPaymentAccumulation(context: PaymentContext): ChronologicalPaymentAccumulation | null {
  const lastValidPaymentDate = context.validPayments.filter((payment) => payment.status === 'VALID')
    .reduce<string | null>((latest, payment) => latest === null || payment.paymentDate > latest ? payment.paymentDate : latest, null);
  if (lastValidPaymentDate === null) return null;
  const pending = context.combinedPlan.filter((entry) => (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n)
    .sort((left, right) => left.dueDate.localeCompare(right.dueDate) || left.sequence - right.sequence || left.id.localeCompare(right.id));
  const previous = pending.filter((entry) => entry.dueDate <= lastValidPaymentDate);
  if (!previous.length) return null;
  const receiver = pending.find((entry) => entry.dueDate > lastValidPaymentDate) ?? null;
  const components = receiver ? [...previous, receiver] : previous;
  const receiverEntryId = receiver?.id ?? null;
  const receiverDate = receiver?.dueDate ?? null;
  const accumulated = components.reduce((sum, entry) => sum + (parseMoneyCents(entry.pendingAmount) ?? 0n), 0n);
  return { lastValidPaymentDate, receiverEntryId, receiverDate, accumulatedAmount: moneyFromCents(accumulated), components };
}

export function paymentTimelineForDisplay(context: PaymentContext): PaymentTimelineRow[] {
  const rows = paymentTimeline(context);
  const accumulation = chronologicalPaymentAccumulation(context);
  if (!accumulation?.receiverEntryId) return rows;
  const hiddenEntryIds = new Set(accumulation.components.filter((entry) => entry.id !== accumulation.receiverEntryId).map((entry) => entry.id));
  return rows.filter((row) => row.kind === 'PAYMENT' || !hiddenEntryIds.has(row.id))
    .map((row) => row.kind === 'PLAN_ENTRY' && row.id === accumulation.receiverEntryId ? { ...row, amount: accumulation.accumulatedAmount } : row);
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

export function appendAutomaticPlanObligation(
  draft: PlanDraftEntry[],
  frequency: PlanFrequency,
  generateKey: () => string = () => crypto.randomUUID(),
): PlanDraftEntry[] {
  const ordered = orderedPlanDraft(draft);
  const latest = ordered.at(-1);
  if (!latest || !Number.isInteger(frequency.intervalValue) || frequency.intervalValue < 1) return draft;
  const theoreticalDate = addInterval(latest.dueDate, frequency.intervalUnit, frequency.intervalValue);
  const normalizedDates = normalizeAutomaticPaymentDates([...ordered.map((entry) => entry.dueDate), theoreticalDate]);
  return [...ordered, { key: generateKey(), id: null, dueDate: normalizedDates.at(-1)!, pendingAmount: '' }];
}

export function adaptPendingPlanToBalance(
  draft: PlanDraftEntry[],
  targetBalance: string,
  frequency: PlanFrequency | null,
  protectedEntryIds: readonly string[] = [],
  generateKey: () => string = () => crypto.randomUUID(),
): AdaptedPlanDraft {
  const target = parseMoneyCents(targetBalance);
  const protectedIds = new Set(protectedEntryIds);
  const source = draft.map((entry, index) => ({ entry, index }))
    .sort((a, b) => a.entry.dueDate.localeCompare(b.entry.dueDate) || a.index - b.index)
    .map(({ entry }) => entry);
  if (target === null || target < 0n || source.some((entry) => parseMoneyCents(entry.pendingAmount) === null))
    return { adaptable: false, entries: draft, reason: 'invalid-amount' };
  const ordered = source.filter((entry) => parseMoneyCents(entry.pendingAmount)! > 0n);

  const protectedTotal = ordered.reduce((total, entry) => protectedIds.has(entry.id ?? '') ? total + parseMoneyCents(entry.pendingAmount)! : total, 0n);
  if (target < protectedTotal) return { adaptable: false, entries: draft, reason: 'protected-total' };

  let mutableRemaining = target - protectedTotal;
  const reconciled: PlanDraftEntry[] = [];
  for (const entry of ordered) {
    if (protectedIds.has(entry.id ?? '')) { reconciled.push(entry); continue; }
    if (mutableRemaining === 0n) continue;
    const current = parseMoneyCents(entry.pendingAmount)!;
    const retained = current < mutableRemaining ? current : mutableRemaining;
    reconciled.push({ ...entry, pendingAmount: moneyFromCents(retained) });
    mutableRemaining -= retained;
  }
  if (mutableRemaining > 0n) {
    let tailIndex = reconciled.length - 1;
    while (tailIndex >= 0 && protectedIds.has(reconciled[tailIndex].id ?? '')) tailIndex -= 1;
    if (tailIndex >= 0) {
      const tail = reconciled[tailIndex];
      reconciled[tailIndex] = { ...tail, pendingAmount: moneyFromCents(parseMoneyCents(tail.pendingAmount)! + mutableRemaining) };
    } else {
      if (!frequency || reconciled.length === 0 || !Number.isInteger(frequency.intervalValue) || frequency.intervalValue < 1)
        return { adaptable: false, entries: draft, reason: 'missing-frequency' };
      const appended = appendAutomaticPlanObligation(reconciled, frequency, generateKey);
      reconciled.splice(0, reconciled.length, ...appended);
      reconciled[reconciled.length - 1] = { ...reconciled.at(-1)!, pendingAmount: moneyFromCents(mutableRemaining) };
    }
  }

  let normalizedDates: string[];
  try { normalizedDates = normalizeAutomaticPaymentDates(reconciled.map((entry) => entry.dueDate)); }
  catch { return { adaptable: false, entries: draft, reason: 'protected-date' }; }
  if (reconciled.some((entry, index) => protectedIds.has(entry.id ?? '') && normalizedDates[index] !== entry.dueDate))
    return { adaptable: false, entries: draft, reason: 'protected-date' };
  return { adaptable: true, entries: reconciled.map((entry, index) => protectedIds.has(entry.id ?? '') ? entry : { ...entry, dueDate: normalizedDates[index] }) };
}

export function reviewPlanDraft(balance: string, draft: PlanDraftEntry[], options: { allowEmpty?: boolean; minDate?: string; protectedEntryIds?: readonly string[] } = {}) {
  const balanceCents = parseMoneyCents(balance);
  const protectedIds = new Set(options.protectedEntryIds ?? []);
  let distributedCents = 0n;
  const entries = orderedPlanDraft(draft).map(({ id, dueDate, pendingAmount }) => {
    const cents = parseMoneyCents(pendingAmount);
    if (cents !== null && cents > 0n) distributedCents += cents;
    return { id, dueDate, pendingAmount: cents === null ? '' : protectedIds.has(id ?? '') ? pendingAmount : moneyFromCents(cents) };
  });
  const dateIssue = draft.length && options.minDate ? paymentPlanDateIssue(options.minDate, draft, true) :
    draft.length ? paymentPlanDateIssue('0001-01-01', draft, true) : null;
  const valid = (draft.length > 0 || (options.allowEmpty === true && balanceCents === 0n)) && balanceCents !== null && balanceCents >= 0n && dateIssue === null && draft.every((entry) =>
    /^\d{4}-\d{2}-\d{2}$/.test(entry.dueDate) && formatDateOnlyForDisplay(entry.dueDate) !== '—'
    && (!options.minDate || entry.dueDate >= options.minDate) && (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n);
  const differenceCents = balanceCents === null ? null : balanceCents - distributedCents;
  return { distributedCents, differenceCents, entries, dateIssue, canSave: valid && differenceCents === 0n };
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
