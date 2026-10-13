import { paymentDateOnlyKey } from './payment-date-only';

export type ConsolidationPlanEntry = Readonly<{
  id: string;
  dueDate: string | Date;
  sequence: number;
  pendingAmount: string;
}>;

export type ConsolidationMutation = Readonly<{
  planEntryId: string;
  pendingBefore: string;
  pendingAfter: string;
}>;

export type ConsolidationTrace = Readonly<{
  sourcePlanEntryId: string;
  targetPlanEntryId: string;
  amount: string;
}>;

export type ChronologicalConsolidation = Readonly<{
  entries: ReadonlyArray<ConsolidationPlanEntry>;
  targetPlanEntryId: string | null;
  consolidatedAmount: string;
  mutations: ReadonlyArray<ConsolidationMutation>;
  traces: ReadonlyArray<ConsolidationTrace>;
  reversalMutations: ReadonlyArray<ConsolidationMutation>;
}>;

const MONEY = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/;

function cents(value: string): bigint {
  if (!MONEY.test(value)) throw new Error('invalid-money');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole) * 100n + BigInt(fraction.padEnd(2, '0'));
}

function money(value: bigint): string {
  return `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;
}

function assertDateOnly(value: string): void {
  const match = DATE_ONLY.exec(value);
  if (!match) throw new Error('invalid-date');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  if (date.getUTCFullYear() !== Number(match[1]) || date.getUTCMonth() !== Number(match[2]) - 1 || date.getUTCDate() !== Number(match[3])) {
    throw new Error('invalid-date');
  }
}

function order(left: ConsolidationPlanEntry, right: ConsolidationPlanEntry): number {
  return paymentDateOnlyKey(left.dueDate).localeCompare(paymentDateOnlyKey(right.dueDate)) ||
    left.sequence - right.sequence || left.id.localeCompare(right.id);
}

export function consolidatePlanAfterPayment(input: Readonly<{
  trigger: 'PAYMENT';
  paymentDate: string;
  financialBalance: string;
  entries: ReadonlyArray<ConsolidationPlanEntry>;
}>): ChronologicalConsolidation {
  if (input.trigger !== 'PAYMENT') throw new Error('unsupported-consolidation-trigger');
  assertDateOnly(input.paymentDate);
  const financialBalance = cents(input.financialBalance);
  const ids = new Set<string>();
  const ordered = input.entries.map((entry) => {
    if (!entry.id || ids.has(entry.id)) throw new Error('invalid-plan-entry-id');
    ids.add(entry.id);
    if (!Number.isSafeInteger(entry.sequence) || entry.sequence <= 0) throw new Error('invalid-plan-entry-sequence');
    assertDateOnly(paymentDateOnlyKey(entry.dueDate));
    cents(entry.pendingAmount);
    return { ...entry };
  }).sort(order);

  const planTotal = ordered.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n);
  if (planTotal !== financialBalance) throw new Error('plan-total-mismatch');

  const sources = ordered.filter((entry) => paymentDateOnlyKey(entry.dueDate) <= input.paymentDate && cents(entry.pendingAmount) > 0n);
  const target = ordered.find((entry) => paymentDateOnlyKey(entry.dueDate) > input.paymentDate && cents(entry.pendingAmount) > 0n);
  if (!sources.length || !target) {
    return { entries: ordered, targetPlanEntryId: null, consolidatedAmount: '0.00', mutations: [], traces: [], reversalMutations: [] };
  }

  const consolidated = sources.reduce((sum, entry) => sum + cents(entry.pendingAmount), 0n);
  const targetBefore = cents(target.pendingAmount);
  const targetAfter = targetBefore + consolidated;
  const sourceIds = new Set(sources.map((entry) => entry.id));
  const entries = ordered.map((entry) => sourceIds.has(entry.id)
    ? { ...entry, pendingAmount: '0.00' }
    : entry.id === target.id ? { ...entry, pendingAmount: money(targetAfter) } : entry);
  const mutations = sources.map((source) => ({
    planEntryId: source.id,
    pendingBefore: money(cents(source.pendingAmount)),
    pendingAfter: '0.00',
  }));
  mutations.push({ planEntryId: target.id, pendingBefore: money(targetBefore), pendingAfter: money(targetAfter) });

  return {
    entries,
    targetPlanEntryId: target.id,
    consolidatedAmount: money(consolidated),
    mutations,
    traces: sources.map((source) => ({
      sourcePlanEntryId: source.id,
      targetPlanEntryId: target.id,
      amount: money(cents(source.pendingAmount)),
    })),
    reversalMutations: [
      { planEntryId: target.id, pendingBefore: money(targetAfter), pendingAfter: money(targetBefore) },
      ...sources.map((source) => ({
        planEntryId: source.id,
        pendingBefore: '0.00',
        pendingAfter: money(cents(source.pendingAmount)),
      })),
    ],
  };
}
