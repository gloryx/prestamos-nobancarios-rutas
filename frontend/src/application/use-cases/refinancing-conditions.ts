import type { LoanPlanEntry } from '../../domain/entities/loan';
import type { RefinancingPreview } from '../../domain/entities/loan-refinancing';
import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import { moneyFromCents, parseMoneyCents } from '../../shared/utils/money';
import { automaticPlan, paymentPlanDateIssue } from './loan-schedule';

export type RefinancingConditions = {
  refinancingDate: string;
  newMoney: string;
  newInterestAmount: string;
  disbursementPaymentMethodId: string;
  paymentFrequencyId: string;
  preferredPaymentMethodId: string;
  observations: string;
  count: string;
  mode: 'automatic' | 'personalized';
  customPlan: LoanPlanEntry[];
};

const MAX_CENTS = 999999999999999999n;

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function evaluateRefinancingConditions(preview: RefinancingPreview, input: RefinancingConditions,
  frequency: PaymentFrequency | undefined, activeMethodIds: string[], today: string) {
  const oldPrincipal = parseMoneyCents(preview.outstandingPrincipal);
  const oldInterest = parseMoneyCents(preview.outstandingInterest);
  const newMoney = parseMoneyCents(input.newMoney);
  const newInterest = parseMoneyCents(input.newInterestAmount);
  const principal = oldPrincipal !== null && oldInterest !== null && newMoney !== null
    ? oldPrincipal + oldInterest + newMoney : null;
  const total = principal !== null && newInterest !== null ? principal + newInterest : null;
  const amountsValid = oldPrincipal !== null && oldInterest !== null && newMoney !== null && newInterest !== null &&
    principal !== null && principal > 0n && principal <= MAX_CENTS && total !== null && total <= MAX_CENTS;
  const dateValid = validDate(input.refinancingDate) && input.refinancingDate >= preview.startDate &&
    input.refinancingDate <= today;
  const count = Number(input.count);
  const countValid = /^\d+$/.test(input.count) && Number.isSafeInteger(count) && count >= 1 && count <= 1000 &&
    total !== null && BigInt(count) <= total;
  const methodsValid = activeMethodIds.includes(input.preferredPaymentMethodId) &&
    (newMoney === 0n || activeMethodIds.includes(input.disbursementPaymentMethodId));
  const generated = amountsValid && dateValid && countValid && frequency?.isActive && frequency.intervalValue > 0
    ? automaticPlan(input.refinancingDate, frequency.intervalUnit, frequency.intervalValue, count, moneyFromCents(total!)) : [];
  const plan = input.mode === 'automatic' ? generated : input.customPlan;
  const planDateIssue = paymentPlanDateIssue(input.refinancingDate, plan);
  const planValid = !!plan.length && dateValid && plan.every((row, index) => {
    const amount = parseMoneyCents(row.pendingAmount);
    return row.sequence === index + 1 && amount !== null && amount > 0n;
  }) && planDateIssue === null;
  const distributed = plan.reduce((sum, row) => sum + (parseMoneyCents(row.pendingAmount) ?? 0n), 0n);
  const difference = total === null ? null : total - distributed;
  return { principal: principal === null ? null : moneyFromCents(principal),
    total: total === null ? null : moneyFromCents(total), plan, generated, difference,
    amountsValid, dateValid, countValid, methodsValid, planValid, planDateIssue,
    valid: preview.eligible && amountsValid && dateValid && !!frequency?.isActive &&
      countValid && methodsValid && planValid && difference === 0n };
}
