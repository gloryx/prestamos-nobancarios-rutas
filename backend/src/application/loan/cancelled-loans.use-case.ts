export const CANCELLED_LOAN_SORTS = ['loanNumber', 'customer', 'startDate', 'cancelledDate', 'principal', 'recoveredInterest', 'totalRecovered'] as const;
export type CancelledLoanSort = typeof CANCELLED_LOAN_SORTS[number];
export type CancelledLoansQuery = { page: number; pageSize: number; search?: string; startDate?: string; endDate?: string; sortBy?: CancelledLoanSort; sortDirection?: 'asc' | 'desc' };
export type CancelledLoanItem = { id: string; loanNumber: string; customerName: string; identification: string; startDate: string; cancelledDate: string | null; principal: string; recoveredInterest: string; totalRecovered: string };
export type CancelledLoansResult = { items: CancelledLoanItem[]; total: number; page: number; pageSize: number; summary: { cancelledLoansCount: number; recoveredAmount: string; realizedProfit: string } };
export interface CancelledLoansReader { list(query: CancelledLoansQuery): Promise<CancelledLoansResult> }
export const CANCELLED_LOANS_READER = Symbol('CANCELLED_LOANS_READER');

export class CancelledLoansValidationError extends Error {}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export class ListCancelledLoansUseCase {
  constructor(private readonly reader: CancelledLoansReader) {}
  execute(query: CancelledLoansQuery): Promise<CancelledLoansResult> {
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 ||
      !Number.isSafeInteger((query.page - 1) * query.pageSize) ||
      (query.startDate && !validDate(query.startDate)) || (query.endDate && !validDate(query.endDate)) ||
      (query.startDate && query.endDate && query.startDate > query.endDate) ||
      (query.sortBy && !CANCELLED_LOAN_SORTS.includes(query.sortBy)) ||
      (query.sortDirection && !['asc', 'desc'].includes(query.sortDirection))) {
      throw new CancelledLoansValidationError('Los filtros de préstamos cancelados no son válidos.');
    }
    return this.reader.list({ ...query, search: query.search?.trim() });
  }
}
