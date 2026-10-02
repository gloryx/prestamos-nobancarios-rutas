import type { LoanEditBody, LoanEditChanges, LoanEditContext } from '../../domain/entities/loan';
import { moneyFromCents, parseMoneyCents } from '../../shared/utils/money';

export type LoanEditDraft = { interestAmount: string; paymentFrequencyId: string; preferredPaymentMethodId: string; observations: string };
export const draftFromLoan = ({ loan }: LoanEditContext): LoanEditDraft => ({
  interestAmount: loan.interestAmount, paymentFrequencyId: loan.paymentFrequencyId,
  preferredPaymentMethodId: loan.preferredPaymentMethodId, observations: loan.observations ?? '',
});

export function reviewLoanEdit(context: LoanEditContext, draft: LoanEditDraft) {
  const { loan, baseline } = context;
  const principal = parseMoneyCents(loan.principal);
  const interest = parseMoneyCents(draft.interestAmount);
  const currentTotal = parseMoneyCents(loan.totalAmount);
  const currentBalance = parseMoneyCents(baseline.financialBalance);
  const originalInterest = parseMoneyCents(baseline.interestAmount);
  const total = principal !== null && interest !== null ? principal + interest : null;
  const balance = total !== null && currentTotal !== null && currentBalance !== null ? total - (currentTotal - currentBalance) : null;
  const validChoice = (id: string, current: string, options: Array<{ id: string; active: boolean }>) =>
    id === current || options.some((option) => option.id === id && option.active);
  const valid = total !== null && total <= 999999999999999999n && balance !== null && balance >= 0n
    && originalInterest !== null && validChoice(draft.paymentFrequencyId, baseline.paymentFrequencyId, context.paymentFrequencyOptions)
    && validChoice(draft.preferredPaymentMethodId, baseline.preferredPaymentMethodId, context.preferredPaymentMethodOptions);
  const changes: LoanEditChanges = {};
  if (valid && interest !== originalInterest) changes.interestAmount = moneyFromCents(interest!);
  if (valid && draft.paymentFrequencyId !== baseline.paymentFrequencyId) changes.paymentFrequencyId = draft.paymentFrequencyId;
  if (valid && draft.preferredPaymentMethodId !== baseline.preferredPaymentMethodId) changes.preferredPaymentMethodId = draft.preferredPaymentMethodId;
  const observations = draft.observations.trim().toUpperCase() || null;
  if (valid && observations !== baseline.observations) changes.observations = observations;
  return { valid, changes, interestChanged: changes.interestAmount !== undefined,
    newTotal: total === null ? null : moneyFromCents(total), newBalance: balance === null ? null : moneyFromCents(balance) };
}

export function loanEditAttempt(previous: { fingerprint: string; key: string } | null, loanId: string, body: Omit<LoanEditBody, 'idempotencyKey'>, generateKey = () => crypto.randomUUID()) {
  const fingerprint = JSON.stringify({ loanId, ...body });
  return previous?.fingerprint === fingerprint ? previous : { fingerprint, key: generateKey() };
}
