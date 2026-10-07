import { cents, evaluateLoanFinancialIntegrity, type LoanFinancialAmounts } from '../../domain/loan/loan-financial-integrity';
import type { LoanEditIdentity, LoanEditReceipt } from '../../domain/loan/loan-edit.types';
import { loanEditBaselineMatches, loanEditFingerprint, normalizeLoanEditSnapshot, LoanEditInputError,
  type LoanEditCurrentSnapshot, type NormalizedLoanEditCommand } from './loan-edit.command';
import type { LoanFinancialTotalsQuery, LoanFinancialTotalsReader } from './loan-financial-totals.reader';
import { applyPaymentPlanDraft } from '../payment/payment-plan-draft';

export class LoanEditNotFoundError extends Error {}
export class LoanEditConflictError extends Error {}
export class LoanEditValidationError extends Error {}
export class LoanEditUnsupportedFinancialError extends Error {}

export type LockedEditLoan = LoanFinancialAmounts & Readonly<{
  id: string; status: string; startDate: string; paymentFrequencyId: string; preferredPaymentMethodId: string; observations: string | null;
}>;
export type LoanEditAdminChanges = Readonly<{
  paymentFrequencyId?: string; preferredPaymentMethodId?: string; observations?: string | null;
}>;
export type LoanEditChanges = LoanEditAdminChanges & Readonly<{ interestAmount?: string; totalAmount?: string }>;
export interface LoanEditTransaction {
  executor: LoanFinancialTotalsQuery;
  lockLoan(id: string): Promise<LockedEditLoan | undefined>;
  findReplay(identity: LoanEditIdentity): Promise<LoanEditReceipt | undefined>;
  readPlan(id: string): Promise<LoanEditCurrentSnapshot['plan']>;
  isActiveReference(kind: 'frequency' | 'method', id: string): Promise<boolean>;
  updateLoan(id: string, changes: LoanEditChanges): Promise<boolean>;
  claim(identity: LoanEditIdentity): Promise<LoanEditReceipt | undefined>;
}
export interface LoanEditWriter {
  transaction<T>(run: (tx: LoanEditTransaction) => Promise<T>): Promise<T>;
}

const money = (amount: bigint): string => `${amount / 100n}.${(amount % 100n).toString().padStart(2, '0')}`;
const isMoney = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value);
const corrupt = () => new LoanEditConflictError('The loan financial state does not reconcile.');

export class EditLoanUseCase {
  constructor(private readonly writer: LoanEditWriter, private readonly totalsReader: LoanFinancialTotalsReader) {}

  async execute(command: NormalizedLoanEditCommand): Promise<LoanEditReceipt> {
    const identity: LoanEditIdentity = { loanId: command.loanId, actorId: command.actorId,
      idempotencyKey: command.idempotencyKey, fingerprint: loanEditFingerprint(command) };
    let lostClaim = false;
    try {
      return await this.writer.transaction(async (tx) => {
        const loan = await tx.lockLoan(command.loanId);
        if (!loan) throw new LoanEditNotFoundError('The loan does not exist.');
        const replay = await tx.findReplay(identity);
        if (replay) return replay;
        if (loan.status !== 'ACTIVE') throw new LoanEditConflictError('Only active loans can be edited.');

        const plan = await tx.readPlan(loan.id);
        const totals = await this.totalsReader.readValidTotals(tx.executor, loan.id);
        if (!plan || !totals || ![loan.principal, loan.interestAmount, loan.totalAmount,
          totals.paidAmount, totals.paidPrincipal, totals.paidInterest].every(isMoney)
          || !Number.isSafeInteger(totals.invalidCount) || totals.invalidCount < 0
          || plan.some((entry) => !isMoney(entry.pendingAmount) || cents(entry.pendingAmount) < 0n)) throw corrupt();
        let snapshot: LoanEditCurrentSnapshot;
        let balance: bigint;
        try {
          const normalized = normalizeLoanEditSnapshot({ interestAmount: loan.interestAmount,
            paymentFrequencyId: loan.paymentFrequencyId, preferredPaymentMethodId: loan.preferredPaymentMethodId,
            observations: loan.observations, financialBalance: '0', plan });
          const pending = normalized.plan.reduce((sum, row) => sum + row.pendingAmount, 0n);
          const integrity = evaluateLoanFinancialIntegrity(loan, totals, pending);
           if (!integrity.valid) throw corrupt();
          balance = integrity.financialBalance;
          snapshot = { interestAmount: loan.interestAmount, paymentFrequencyId: loan.paymentFrequencyId,
            preferredPaymentMethodId: loan.preferredPaymentMethodId, observations: loan.observations,
            financialBalance: money(balance), plan };
        } catch (error) {
          if (error instanceof LoanEditInputError || error instanceof RangeError || error instanceof SyntaxError) throw corrupt();
          throw error;
        }
        if (!loanEditBaselineMatches(command.baseline, snapshot)) throw new LoanEditConflictError('The loan changed since it was opened.');
        const interestChanged = command.changes.interestAmount !== undefined && command.changes.interestAmount !== cents(loan.interestAmount);
        if (interestChanged && command.plan === undefined) throw new LoanEditValidationError('An interest change requires a payment plan.');
        if (!interestChanged && command.plan !== undefined) throw new LoanEditValidationError('A payment plan requires an interest change.');

        const changes: { paymentFrequencyId?: string; preferredPaymentMethodId?: string; observations?: string | null;
          interestAmount?: string; totalAmount?: string } = {};
        if (command.changes.paymentFrequencyId !== undefined && command.changes.paymentFrequencyId !== loan.paymentFrequencyId.toLowerCase()) {
          if (!await tx.isActiveReference('frequency', command.changes.paymentFrequencyId)) throw new LoanEditValidationError('The payment frequency is inactive or does not exist.');
          changes.paymentFrequencyId = command.changes.paymentFrequencyId;
        }
        if (command.changes.preferredPaymentMethodId !== undefined && command.changes.preferredPaymentMethodId !== loan.preferredPaymentMethodId.toLowerCase()) {
          if (!await tx.isActiveReference('method', command.changes.preferredPaymentMethodId)) throw new LoanEditValidationError('The payment method is inactive or does not exist.');
          changes.preferredPaymentMethodId = command.changes.preferredPaymentMethodId;
        }
        if (command.changes.observations !== undefined && command.changes.observations !== command.baseline.observations) {
          changes.observations = command.changes.observations;
        }
        if (!interestChanged && !Object.keys(changes).length) throw new LoanEditValidationError('The edit does not change any field.');
        if (interestChanged) {
          const newInterest = command.changes.interestAmount!;
          const newTotal = cents(loan.principal) + newInterest;
          const validPaidInterest = cents(totals.paidInterest);
          const validPaidAmount = cents(totals.paidAmount);
          if (newInterest < validPaidInterest) {
            throw new LoanEditValidationError(`El interés propuesto no puede ser menor que el interés ya aplicado. Ingrese un interés de al menos ${money(validPaidInterest)}.`);
          }
          if (newTotal < validPaidAmount) {
            throw new LoanEditValidationError(`El nuevo total contractual no puede ser menor que el monto ya pagado. Ajuste el interés para que el total sea de al menos ${money(validPaidAmount)}.`);
          }
          const newBalance = newTotal - cents(totals.paidAmount);
          const proposed = evaluateLoanFinancialIntegrity({ principal: loan.principal,
            interestAmount: money(newInterest), totalAmount: money(newTotal) }, totals, newBalance);
          if (!proposed.valid) throw new LoanEditValidationError('The proposed loan financial state does not reconcile.');
          changes.interestAmount = money(newInterest);
          changes.totalAmount = money(newTotal);
          // The loan lock precedes both the shared plan writer and the Loan UPDATE.
          const drafted = await applyPaymentPlanDraft(tx.executor, loan.id, loan.startDate, newBalance,
            command.plan!.map((entry) => ({ id: entry.id, dueDate: entry.dueDate, pendingAmount: money(entry.pendingAmount) })));
          if (!await tx.updateLoan(loan.id, changes)) throw new LoanEditConflictError('The loan changed during the edit.');
          const persistedLoan = await tx.lockLoan(loan.id);
          const persistedPlan = await tx.readPlan(loan.id);
          const persistedTotals = await this.totalsReader.readValidTotals(tx.executor, loan.id);
          if (!persistedLoan || !persistedPlan || !persistedTotals || ![persistedLoan.principal, persistedLoan.interestAmount,
            persistedLoan.totalAmount, persistedTotals.paidAmount, persistedTotals.paidPrincipal, persistedTotals.paidInterest].every(isMoney)
            || persistedPlan.some((row) => !isMoney(row.pendingAmount) || cents(row.pendingAmount) < 0n)
            || persistedLoan.id !== loan.id || persistedLoan.status !== loan.status || persistedLoan.startDate !== loan.startDate
            || cents(persistedLoan.principal) !== cents(loan.principal) || cents(persistedLoan.interestAmount) !== newInterest
            || cents(persistedLoan.totalAmount) !== newTotal) throw corrupt();
          try {
            const final = evaluateLoanFinancialIntegrity(persistedLoan, persistedTotals,
              persistedPlan.reduce((sum, row) => sum + cents(row.pendingAmount), 0n));
            const expected = normalizeLoanEditSnapshot({ interestAmount: money(newInterest),
              paymentFrequencyId: changes.paymentFrequencyId ?? loan.paymentFrequencyId,
              preferredPaymentMethodId: changes.preferredPaymentMethodId ?? loan.preferredPaymentMethodId,
              observations: changes.observations !== undefined ? changes.observations : loan.observations,
              financialBalance: money(newBalance), plan: drafted });
            const knownIds = new Set(command.plan!.flatMap((row) => row.id === null ? [] : [row.id]));
            const requestedRows = command.plan!.map((row) => `${row.id ?? ''}|${row.dueDate}|${row.pendingAmount}`).sort();
            const draftedRows = expected.plan.map((row) => `${knownIds.has(row.id) ? row.id : ''}|${row.dueDate}|${row.pendingAmount}`).sort();
            if (!final.valid || final.financialBalance !== newBalance || final.validPaidAmount !== cents(totals.paidAmount)
              || final.validPrincipalApplied !== cents(totals.paidPrincipal) || final.validInterestApplied !== cents(totals.paidInterest)
              || JSON.stringify(requestedRows) !== JSON.stringify(draftedRows)
              || !loanEditBaselineMatches(expected, { ...persistedLoan, financialBalance: money(final.financialBalance), plan: persistedPlan })) throw corrupt();
          } catch (error) {
            if (error instanceof LoanEditInputError || error instanceof RangeError || error instanceof SyntaxError) throw corrupt();
            throw error;
          }
        } else if (!await tx.updateLoan(loan.id, changes)) throw new LoanEditConflictError('The loan changed during the edit.');
        const receipt = await tx.claim(identity);
        if (!receipt) {
          lostClaim = true;
          throw new LoanEditConflictError('The edit key was claimed concurrently.');
        }
        return receipt;
      });
    } catch (error) {
      if (!lostClaim || !(error instanceof LoanEditConflictError)) throw error;
      // The losing transaction has rolled back; read the committed winner in a fresh transaction.
      const winner = await this.writer.transaction((tx) => tx.findReplay(identity));
      if (!winner) throw new LoanEditConflictError('The edit key was claimed concurrently.');
      return winner;
    }
  }
}
