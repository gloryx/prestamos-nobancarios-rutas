import type { CurrentIdentity } from '../../domain/security/security.types';
import type { ActiveLoanListQuery, LoanSortBy } from '../../domain/loan/loan.types';

export const ASSIGNED_LOAN_STATUSES = ['ACTIVE', 'CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'] as const;
export type AssignedLoanStatus = (typeof ASSIGNED_LOAN_STATUSES)[number];
export type AssignedLoanQuery = ActiveLoanListQuery & { status?: AssignedLoanStatus | 'ALL' };
export type AssignedLoansScope = { kind: 'ALL' } | { kind: 'COLLECTOR'; collectorUserId: string };
export type AssignedLoanListItem = {
  id: string; loanNumber: string; startDate: string; principal: string; interestAmount: string; totalAmount: string;
  customerName: string; identification: string; primaryPhone: string; frequencyName: string; pendingTotal: string;
  nextDueDate: string | null; nextDueAmount: string | null; isOverdue: boolean; status: AssignedLoanStatus;
};
export interface AssignedLoansReader {
  resolveCollector(userId: string): Promise<boolean>;
  list(query: AssignedLoanQuery, scope: AssignedLoansScope): Promise<{ items: AssignedLoanListItem[]; total: number; page: number; pageSize: number }>;
  detail(id: string, scope: AssignedLoansScope): Promise<unknown | null>;
}
export const ASSIGNED_LOANS_READER = Symbol('ASSIGNED_LOANS_READER');
export class AssignedLoansForbiddenError extends Error {}
export class AssignedLoansValidationError extends Error {}

const sorts: readonly LoanSortBy[] = ['number', 'customer', 'startDate', 'principal', 'interest', 'total', 'frequency', 'pending', 'condition'];

export class AssignedLoansUseCase {
  constructor(private readonly reader: AssignedLoansReader) {}

  async list(query: AssignedLoanQuery, actor: CurrentIdentity) {
    const scope = await this.collectorScope(actor);
    if (!Number.isSafeInteger(query.page) || query.page < 1 || !Number.isSafeInteger(query.pageSize) || query.pageSize < 1 || query.pageSize > 100 ||
      !Number.isSafeInteger(query.page * query.pageSize) || (query.search !== undefined && query.search.length > 200) ||
      (query.status !== undefined && query.status !== 'ALL' && !ASSIGNED_LOAN_STATUSES.includes(query.status)) ||
      (query.sortBy !== undefined && !sorts.includes(query.sortBy)) ||
      (query.sortOrder !== undefined && query.sortOrder !== 'asc' && query.sortOrder !== 'desc'))
      throw new AssignedLoansValidationError('Los filtros de préstamos asignados no son válidos.');
    return this.reader.list({ ...query, search: query.search?.trim() || undefined, status: 'ACTIVE' }, scope);
  }

  async detail(id: string, actor: CurrentIdentity) {
    const result = await this.reader.detail(id, await this.collectorScope(actor));
    if (!result) throw new AssignedLoansForbiddenError('El préstamo no pertenece a un cliente actualmente asignado.');
    return result;
  }

  private async collectorScope(actor: CurrentIdentity): Promise<AssignedLoansScope> {
    if (actor.role.isSuperAdmin) return { kind: 'ALL' };
    if (actor.role.code !== 'COLLECTOR' || !await this.reader.resolveCollector(actor.id))
      throw new AssignedLoansForbiddenError('El usuario autenticado no posee un perfil de cobrador activo.');
    return { kind: 'COLLECTOR', collectorUserId: actor.id };
  }
}
