import type { LoanFinancialBatchQuery, LoanFinancialBatchProjection, LoanFinancialBatchReader } from '../../../../application/loan/loan-financial-batch.reader';
import { cents, evaluateLoanFinancialIntegrity, type LoanFinancialAmounts, type ValidPaymentTotals } from '../../../../domain/loan/loan-financial-integrity';
import { VALID_PAYMENT_TOTALS_SELECT } from './loan-financial-totals.reader';

type LoanRow = LoanFinancialAmounts & { id: string };
type PaymentRow = ValidPaymentTotals & { loanId: string };
type PlanRow = { loanId: string; pendingAmount: string };

const isMoney = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value);
const hasId = (value: unknown): value is { loanId: string } => !!value && typeof value === 'object' &&
  'loanId' in value && typeof value.loanId === 'string';
const isLoan = (value: unknown): value is LoanRow => !!value && typeof value === 'object' &&
  'id' in value && typeof value.id === 'string' && 'principal' in value && isMoney(value.principal) &&
  'interestAmount' in value && isMoney(value.interestAmount) && 'totalAmount' in value && isMoney(value.totalAmount);
const isPayment = (value: unknown): value is PaymentRow => hasId(value) &&
  'paidAmount' in value && isMoney(value.paidAmount) && 'paidPrincipal' in value && isMoney(value.paidPrincipal) &&
  'paidInterest' in value && isMoney(value.paidInterest) && 'invalidCount' in value &&
  typeof value.invalidCount === 'number' && Number.isSafeInteger(value.invalidCount) && value.invalidCount >= 0;
const isPlan = (value: unknown): value is PlanRow => hasId(value) && 'pendingAmount' in value && isMoney(value.pendingAmount);

const emptyTotals: ValidPaymentTotals = { paidAmount: '0', paidPrincipal: '0', paidInterest: '0', invalidCount: 0 };

export class LoanFinancialBatchTypeormReader implements LoanFinancialBatchReader {
  async readLoanFinancialIntegrityBatch(executor: LoanFinancialBatchQuery, loanIds: readonly string[]): Promise<Map<string, LoanFinancialBatchProjection>> {
    const result = new Map<string, LoanFinancialBatchProjection>();
    const requested = new Set(loanIds.map((id) => id.toLowerCase()));
    const ids = [...requested];
    if (ids.length === 0) return result;

    const loans = await executor.query(`SELECT id, principal::text AS principal, interest_amount::text AS "interestAmount", total_amount::text AS "totalAmount" FROM loans WHERE id = ANY($1::uuid[])`, [ids]);
    const payments = await executor.query(`SELECT loan_id AS "loanId", ${VALID_PAYMENT_TOTALS_SELECT} FROM payments WHERE loan_id = ANY($1::uuid[]) AND status = 'VALID' GROUP BY loan_id`, [ids]);
    const plan = await executor.query(`SELECT loan_id AS "loanId", COALESCE(SUM(pending_amount), 0)::text AS "pendingAmount" FROM payment_plan_entries WHERE loan_id = ANY($1::uuid[]) AND pending_amount > 0 GROUP BY loan_id`, [ids]);

    const loanById = new Map<string, LoanRow>();
    for (const row of loans) {
      if (!isLoan(row) || !requested.has(row.id.toLowerCase())) throw new Error('Invalid loan financial batch loan.');
      loanById.set(row.id.toLowerCase(), row);
    }
    const paymentById = new Map<string, ValidPaymentTotals>();
    for (const row of payments) {
      if (!isPayment(row) || !requested.has(row.loanId.toLowerCase())) throw new Error('Invalid loan financial batch payment totals.');
      const { loanId, ...totals } = row;
      paymentById.set(loanId.toLowerCase(), totals);
    }
    const planById = new Map<string, PlanRow>();
    for (const row of plan) {
      if (!isPlan(row) || !requested.has(row.loanId.toLowerCase())) throw new Error('Invalid loan financial batch plan total.');
      planById.set(row.loanId.toLowerCase(), row);
    }

    for (const id of ids) {
      const loan = loanById.get(id);
      if (!loan) continue;
      const { principal, interestAmount, totalAmount } = loan;
      const validTotals = paymentById.get(id) ?? { ...emptyTotals };
      const pendingPlanAmount = planById.get(id)?.pendingAmount ?? '0';
      const financialSnapshot = { principal, interestAmount, totalAmount, validTotals, pendingPlanAmount };
      result.set(loan.id, { loanId: loan.id, financialSnapshot,
        integrityResult: evaluateLoanFinancialIntegrity(loan, validTotals, cents(pendingPlanAmount)) });
    }
    return result;
  }
}
