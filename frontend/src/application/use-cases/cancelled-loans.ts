import type { CancelledLoansResult } from '../../domain/entities/loan';

export type CancelledLoanSort = 'loanNumber' | 'customer' | 'startDate' | 'cancelledDate' | 'principal' | 'recoveredInterest' | 'totalRecovered';
export type CancelledLoansQuery = { page: number; pageSize: number; search?: string; startDate?: string; endDate?: string; sortBy?: CancelledLoanSort; sortDirection?: 'asc' | 'desc' };
export interface CancelledLoansReader { list(query: CancelledLoansQuery): Promise<CancelledLoansResult> }

export class ListCancelledLoans {
  constructor(private readonly reader: CancelledLoansReader) {}
  execute(query: CancelledLoansQuery): Promise<CancelledLoansResult> { return this.reader.list(query); }
}
