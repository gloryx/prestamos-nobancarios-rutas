import type { LoanFinancialBatchProjection } from './loan-financial-batch.reader';

export type ActiveLoanExportCandidate = {
  id: string;
  loanNumber: string;
  identification: string;
  customerName: string;
  phone: string;
  startDate: string;
  principal: string;
  interestAmount: string;
  totalAmount: string;
  frequencyName: string;
  dueDate: string;
  status: 'ACTIVE';
};

export type ActiveLoanExportItem = Omit<ActiveLoanExportCandidate, 'id'> & {
  outstandingPrincipal: string;
  outstandingInterest: string;
  financialBalance: string;
};

export type ActiveLoanExportSnapshot = {
  candidates: ActiveLoanExportCandidate[];
  financial: Map<string, LoanFinancialBatchProjection>;
};

export interface ActiveLoanExportReader { read(): Promise<ActiveLoanExportSnapshot> }

export class ActiveLoanExportIntegrityError extends Error {}

const money = (value: bigint): string => `${value / 100n}.${(value % 100n).toString().padStart(2, '0')}`;

export class ExportActiveLoansUseCase {
  constructor(private readonly reader: ActiveLoanExportReader) {}

  private project(snapshot: ActiveLoanExportSnapshot, includeItems: boolean) {
    let capitalPlaced = 0n;
    let outstandingPrincipal = 0n;
    let outstandingInterest = 0n;
    let financialBalance = 0n;
    const items: ActiveLoanExportItem[] = [];
    for (const { id, ...candidate } of snapshot.candidates) {
      const projection = snapshot.financial.get(id);
      if (!projection?.integrityResult.valid) throw new ActiveLoanExportIntegrityError('Active loan balances do not reconcile.');
      const result = projection.integrityResult;
      capitalPlaced += result.outstandingPrincipal + result.validPrincipalApplied;
      outstandingPrincipal += result.outstandingPrincipal;
      outstandingInterest += result.outstandingInterest;
      financialBalance += result.financialBalance;
      if (includeItems) items.push({ ...candidate, outstandingPrincipal: money(result.outstandingPrincipal),
        outstandingInterest: money(result.outstandingInterest), financialBalance: money(result.financialBalance) });
    }
    return { items, summary: { totalActiveLoans: snapshot.candidates.length, capitalPlaced: money(capitalPlaced),
      outstandingPrincipal: money(outstandingPrincipal), outstandingInterest: money(outstandingInterest),
      financialBalance: money(financialBalance) } };
  }

  async execute() { return this.project(await this.reader.read(), true); }

  async executeSummary() { return this.project(await this.reader.read(), false).summary; }
}
