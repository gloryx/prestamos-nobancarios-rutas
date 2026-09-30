import { cents } from '../../domain/loan/loan-financial-integrity';
import type { LoanFinancialBatchProjection } from './loan-financial-batch.reader';
import { evaluateUncollectibleEligibilityFromSnapshot, isDateOnly } from './uncollectible-eligibility.use-case';

export const OVERDUE_LOAN_SORTS = ['loanNumber', 'customer', 'startDate', 'firstOverdueDueDate', 'principal', 'recoveredAmount', 'financialBalance'] as const;
export type OverdueLoanSort = typeof OVERDUE_LOAN_SORTS[number];
export type OverdueLoansQuery = { search?: string; startDate?: string; endDate?: string; page: number; pageSize: number; sortBy?: OverdueLoanSort; sortDir?: 'asc' | 'desc' };
export type OverdueCandidate = { loanId: string; loanNumber: string; customerId: string; identification: string; fullName: string;
  startDate: string; firstRowId: string; firstOverdueDueDate: string; firstOverdueAmount: string;
  principal: string; interestAmount: string; totalAmount: string };
export type OverdueSnapshot = { candidates: OverdueCandidate[]; financial: Map<string, LoanFinancialBatchProjection> };
export interface OverdueLoansReader { read(query: OverdueLoansQuery, today: string): Promise<OverdueSnapshot> }
export const OVERDUE_LOANS_READER = Symbol('OVERDUE_LOANS_READER');
export class OverdueLoansValidationError extends Error {}

export type OverdueLoanItem = { loanId: string; loanNumber: string; customer: { id: string; identification: string; fullName: string };
  startDate: string; firstOverdueDueDate: string; firstOverdueAmount: string; principal: string; interestAmount: string;
  totalAmount: string; recoveredAmount: string; financialBalance: string; status: 'ACTIVE'; canMarkUncollectible: true };

const money = (value: bigint) => {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
};
const compare = (a: string | bigint, b: string | bigint) => a < b ? -1 : a > b ? 1 : 0;
const monetary = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value);

export class ListOverdueLoansUseCase {
  constructor(private readonly reader: OverdueLoansReader,
    private readonly today: () => string = () => new Date().toISOString().slice(0, 10),
    private readonly reportInvalid: (count: number) => void = (count) => console.warn(`Excluded ${count} financially invalid overdue loan candidates.`)) {}

  async execute(query: OverdueLoansQuery) {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || ![10, 20, 50].includes(query.pageSize) ||
      !Number.isSafeInteger((query.page - 1) * query.pageSize) ||
      (query.startDate !== undefined && !isDateOnly(query.startDate)) ||
      (query.endDate !== undefined && !isDateOnly(query.endDate)) ||
      (query.startDate && query.endDate && query.startDate > query.endDate) ||
      (query.sortBy !== undefined && !OVERDUE_LOAN_SORTS.includes(query.sortBy)) ||
      (query.sortDir !== undefined && !['asc', 'desc'].includes(query.sortDir))) {
      throw new OverdueLoansValidationError('Los filtros de préstamos vencidos no son válidos.');
    }
    const today = this.today();
    const { candidates, financial } = await this.reader.read({ ...query, search: query.search?.trim() }, today);
    const eligible: Array<{ row: OverdueCandidate; projection: LoanFinancialBatchProjection }> = [];
    let invalid = 0;
    for (const row of candidates) {
      if (!row || typeof row.loanId !== 'string' || !row.loanId || !/^\d+$/.test(row.loanNumber) ||
        typeof row.customerId !== 'string' || typeof row.identification !== 'string' || typeof row.fullName !== 'string' ||
        !isDateOnly(row.startDate) || !isDateOnly(row.firstOverdueDueDate) || typeof row.firstRowId !== 'string' || !row.firstRowId ||
        !monetary(row.firstOverdueAmount) || cents(row.firstOverdueAmount) <= 0n ||
        !monetary(row.principal) || !monetary(row.interestAmount) || !monetary(row.totalAmount)) {
        throw new Error('Invalid overdue loan candidate.');
      }
      const projection = financial.get(row.loanId);
      if (!projection) throw new Error('Missing overdue loan financial projection.');
      const integrity = projection.integrityResult;
      if (!integrity.valid) invalid++;
      const first = { id: row.firstRowId, dueDate: row.firstOverdueDueDate, pendingAmount: row.firstOverdueAmount };
      if (evaluateUncollectibleEligibilityFromSnapshot(row.loanId, 'ACTIVE', integrity.pendingPlanAmount, first, integrity, today).canMarkUncollectible) {
        eligible.push({ row, projection });
      }
    }
    if (invalid) this.reportInvalid(invalid);

    const sortBy = query.sortBy ?? 'firstOverdueDueDate';
    const sortValue = ({ row, projection }: typeof eligible[number]): string | bigint => {
      switch (sortBy) {
        case 'loanNumber': return BigInt(row.loanNumber);
        case 'customer': return row.fullName.toLowerCase();
        case 'startDate': return row.startDate;
        case 'firstOverdueDueDate': return row.firstOverdueDueDate;
        case 'principal': return cents(row.principal);
        case 'recoveredAmount': return projection.integrityResult.validPaidAmount;
        case 'financialBalance': return projection.integrityResult.financialBalance;
      }
    };
    eligible.sort((a, b) => (query.sortDir === 'desc' ? -1 : 1) * compare(sortValue(a), sortValue(b)) ||
      compare(BigInt(a.row.loanNumber), BigInt(b.row.loanNumber)) || compare(a.row.loanId, b.row.loanId));

    const summary = eligible.reduce((totals, { row, projection }) => ({
      lent: totals.lent + cents(row.principal),
      recovered: totals.recovered + projection.integrityResult.validPaidAmount,
      pending: totals.pending + projection.integrityResult.financialBalance,
    }), { lent: 0n, recovered: 0n, pending: 0n });
    const offset = (query.page - 1) * query.pageSize;
    const items: OverdueLoanItem[] = eligible.slice(offset, offset + query.pageSize).map(({ row, projection }) => ({
      loanId: row.loanId, loanNumber: row.loanNumber,
      customer: { id: row.customerId, identification: row.identification, fullName: row.fullName },
      startDate: row.startDate, firstOverdueDueDate: row.firstOverdueDueDate, firstOverdueAmount: money(cents(row.firstOverdueAmount)),
      principal: money(cents(row.principal)), interestAmount: money(cents(row.interestAmount)), totalAmount: money(cents(row.totalAmount)),
      recoveredAmount: money(projection.integrityResult.validPaidAmount), financialBalance: money(projection.integrityResult.financialBalance),
      status: 'ACTIVE', canMarkUncollectible: true,
    }));
    return { items, total: eligible.length, page: query.page, pageSize: query.pageSize,
      summary: { total: eligible.length, lentAmount: money(summary.lent), recoveredAmount: money(summary.recovered), pendingAmount: money(summary.pending) } };
  }
}
