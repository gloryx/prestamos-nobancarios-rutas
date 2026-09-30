import { cents } from '../../domain/loan/loan-financial-integrity';
import type { LoanFinancialBatchProjection } from './loan-financial-batch.reader';
import { isDateOnly } from './uncollectible-eligibility.use-case';

export const UNCOLLECTIBLE_LOAN_SORTS = ['loanNumber', 'customer', 'startDate', 'uncollectibleDate', 'principal', 'recoveredAmount', 'financialBalance'] as const;
export type UncollectibleLoanSort = typeof UNCOLLECTIBLE_LOAN_SORTS[number];
export type UncollectibleLoansQuery = { search?: string; startDate?: string; endDate?: string; page: number; pageSize: number;
  sortBy?: UncollectibleLoanSort; sortDir?: 'asc' | 'desc' };
export type UncollectibleCandidate = { loanId: string; loanNumber: string; customerId: string; identification: string; fullName: string;
  startDate: string; principal: string; interestAmount: string; totalAmount: string; eventId: string | null;
  fromStatus: string | null; toStatus: string | null; uncollectibleAt: string | null; uncollectibleBusinessDate: string | null;
  uncollectibleReason: string | null; changedByUserId: string | null };
export type UncollectibleSnapshot = { candidates: UncollectibleCandidate[]; financial: Map<string, LoanFinancialBatchProjection> };
export interface UncollectibleLoansReader { read(query: UncollectibleLoansQuery): Promise<UncollectibleSnapshot> }
export const UNCOLLECTIBLE_LOANS_READER = Symbol('UNCOLLECTIBLE_LOANS_READER');
export class UncollectibleLoansValidationError extends Error {}
export class UncollectibleLoansIntegrityError extends Error {}

const money = (value: bigint) => {
  const magnitude = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${magnitude / 100n}.${(magnitude % 100n).toString().padStart(2, '0')}`;
};
const compare = (a: string | bigint, b: string | bigint) => a < b ? -1 : a > b ? 1 : 0;
const monetary = (value: unknown): value is string => typeof value === 'string' && /^-?\d+(?:\.\d{1,2})?$/.test(value);

// Validate the latest transition, never an older declaration from a previous loan episode.
export function assertCurrentDeclaration(row: UncollectibleCandidate): void {
  if (!row || !row.eventId || row.fromStatus !== 'ACTIVE' || row.toStatus !== 'UNCOLLECTIBLE' ||
    typeof row.uncollectibleAt !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.uncollectibleAt) ||
    !isDateOnly(row.uncollectibleBusinessDate) ||
    (row.uncollectibleReason !== null && typeof row.uncollectibleReason !== 'string') ||
    (row.changedByUserId !== null && typeof row.changedByUserId !== 'string')) {
    throw new UncollectibleLoansIntegrityError(`Invalid current uncollectible declaration for loan ${row?.loanId ?? 'unknown'}.`);
  }
}

export class ListUncollectibleLoansUseCase {
  constructor(private readonly reader: UncollectibleLoansReader) {}

  async execute(query: UncollectibleLoansQuery) {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || ![10, 20, 50].includes(query.pageSize) ||
      !Number.isSafeInteger((query.page - 1) * query.pageSize) ||
      (query.startDate !== undefined && !isDateOnly(query.startDate)) ||
      (query.endDate !== undefined && !isDateOnly(query.endDate)) ||
      (query.startDate && query.endDate && query.startDate > query.endDate) ||
      (query.sortBy !== undefined && !UNCOLLECTIBLE_LOAN_SORTS.includes(query.sortBy)) ||
      (query.sortDir !== undefined && !['asc', 'desc'].includes(query.sortDir))) {
      throw new UncollectibleLoansValidationError('Los filtros de préstamos incobrables no son válidos.');
    }
    const { candidates, financial } = await this.reader.read({ ...query, search: query.search?.trim() });
    const selected: Array<{ row: UncollectibleCandidate; projection: LoanFinancialBatchProjection }> = [];
    for (const row of candidates) {
      assertCurrentDeclaration(row);
      if (!row.loanId || !/^\d+$/.test(row.loanNumber) || !row.customerId ||
        typeof row.identification !== 'string' || typeof row.fullName !== 'string' || !isDateOnly(row.startDate) ||
        !monetary(row.principal) || !monetary(row.interestAmount) || !monetary(row.totalAmount)) {
        throw new UncollectibleLoansIntegrityError(`Invalid uncollectible loan candidate ${row.loanId}.`);
      }
      const projection = financial.get(row.loanId);
      if (!projection || !projection.integrityResult.valid) {
        throw new UncollectibleLoansIntegrityError(`Missing or invalid financial integrity for loan ${row.loanId}.`);
      }
      selected.push({ row, projection });
    }
    const sortBy = query.sortBy ?? 'uncollectibleDate';
    const sortValue = ({ row, projection }: typeof selected[number]): string | bigint => {
      switch (sortBy) {
        case 'loanNumber': return BigInt(row.loanNumber);
        case 'customer': return row.fullName.toLowerCase();
        case 'startDate': return row.startDate;
        case 'uncollectibleDate': return row.uncollectibleAt!;
        case 'principal': return cents(row.principal);
        case 'recoveredAmount': return projection.integrityResult.validPaidAmount;
        case 'financialBalance': return projection.integrityResult.financialBalance;
      }
    };
    selected.sort((a, b) => (query.sortDir ?? 'desc') === 'desc' ?
      -compare(sortValue(a), sortValue(b)) || compare(BigInt(a.row.loanNumber), BigInt(b.row.loanNumber)) || compare(a.row.loanId, b.row.loanId) :
      compare(sortValue(a), sortValue(b)) || compare(BigInt(a.row.loanNumber), BigInt(b.row.loanNumber)) || compare(a.row.loanId, b.row.loanId));
    const summary = selected.reduce((totals, { row, projection }) => ({
      lent: totals.lent + cents(row.principal), recovered: totals.recovered + projection.integrityResult.validPaidAmount,
      pending: totals.pending + projection.integrityResult.financialBalance,
    }), { lent: 0n, recovered: 0n, pending: 0n });
    const offset = (query.page - 1) * query.pageSize;
    const items = selected.slice(offset, offset + query.pageSize).map(({ row, projection }) => ({
      loanId: row.loanId, loanNumber: row.loanNumber,
      customer: { id: row.customerId, identification: row.identification, fullName: row.fullName },
      startDate: row.startDate, uncollectibleAt: row.uncollectibleAt!, uncollectibleBusinessDate: row.uncollectibleBusinessDate!,
      uncollectibleReason: row.uncollectibleReason, changedByUserId: row.changedByUserId,
      principal: money(cents(row.principal)), interestAmount: money(cents(row.interestAmount)), totalAmount: money(cents(row.totalAmount)),
      recoveredAmount: money(projection.integrityResult.validPaidAmount), financialBalance: money(projection.integrityResult.financialBalance),
      status: 'UNCOLLECTIBLE' as const,
    }));
    return { items, total: selected.length, page: query.page, pageSize: query.pageSize,
      summary: { total: selected.length, lentAmount: money(summary.lent), recoveredAmount: money(summary.recovered), pendingAmount: money(summary.pending) } };
  }
}
