export type DailyCollectionSummary = { date: string; dueCount: number; paidLoansCount: number; dueAmount: string; receivedAmount: string };
export type DailyCollectionCustomer = { id: string; identification: string; fullName: string; primaryPhone: string };
export type DailyDueItem = { planEntryId: string; sequence: number; dueDate: string; pendingAmount: string;
  loan: { id: string; loanNumber: string }; customer: DailyCollectionCustomer };
export type DailyReceivedItem = { paymentId: string; paymentDate: string; amount: string;
  loan: { id: string; loanNumber: string }; customer: Omit<DailyCollectionCustomer, 'primaryPhone'>;
  paymentMethod: { id: string; name: string }; collector: { id: string; name: string } | null };
export type DailyCollectionPage<T> = { items: T[]; total: number; page: number; pageSize: number };
export type DailyDueSort = 'customer' | 'loanNumber' | 'sequence' | 'dueDate' | 'pendingAmount';
export type DailyReceivedSort = 'customer' | 'loanNumber' | 'amount';
export type DailyCollectionQuery = { date: string; search?: string; page?: number; pageSize?: number; sortBy?: string; sortDir?: string };
export type ValidDailyQuery<Sort extends string> = { date: string; search?: string; page: number; pageSize: number; sortBy: Sort; sortDir: 'asc' | 'desc' };
export type DailyCollectionsScope = { kind: 'ALL' } | { kind: 'COLLECTOR'; collectorUserId: string };
export interface DailyCollectionsReader {
  resolveCollector(userId: string): Promise<boolean>;
  summary(date: string, scope?: DailyCollectionsScope): Promise<Omit<DailyCollectionSummary, 'date'>>;
  due(query: ValidDailyQuery<DailyDueSort>, scope?: DailyCollectionsScope): Promise<DailyCollectionPage<DailyDueItem>>;
  received(query: ValidDailyQuery<DailyReceivedSort>, scope?: DailyCollectionsScope): Promise<DailyCollectionPage<DailyReceivedItem>>;
}
export const DAILY_COLLECTIONS_READER = Symbol('DAILY_COLLECTIONS_READER');
export class DailyCollectionsValidationError extends Error {}
export class DailyCollectionsForbiddenError extends Error {}

function validDate(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export class DailyCollectionsUseCase {
  constructor(private readonly reader: DailyCollectionsReader, private readonly now: () => Date = () => new Date()) {}
  async summary(date: string): Promise<DailyCollectionSummary> {
    if (!validDate(date)) throw new DailyCollectionsValidationError('La fecha de consulta no es válida.');
    return { date, ...await this.reader.summary(date) };
  }
  private query<Sort extends string>(input: DailyCollectionQuery, sorts: readonly Sort[]): ValidDailyQuery<Sort> {
    const page = input.page ?? 1, pageSize = input.pageSize ?? 20;
    if (!validDate(input.date) || !Number.isSafeInteger(page) || page < 1 ||
      !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger(page * pageSize) ||
      (input.search !== undefined && (typeof input.search !== 'string' || input.search.length > 200)) ||
      (input.sortBy !== undefined && !sorts.includes(input.sortBy as Sort)) ||
      (input.sortDir !== undefined && input.sortDir !== 'asc' && input.sortDir !== 'desc')) {
      throw new DailyCollectionsValidationError('Los filtros de cobros del día no son válidos.');
    }
    return { date: input.date, ...(input.search?.trim() ? { search: input.search.trim() } : {}),
      page, pageSize, sortBy: (input.sortBy ?? sorts[0]) as Sort, sortDir: (input.sortDir ?? 'asc') as 'asc' | 'desc' };
  }
  due(query: DailyCollectionQuery) {
    return this.reader.due(this.query(query, ['customer', 'loanNumber', 'sequence', 'dueDate', 'pendingAmount'] as const));
  }
  received(query: DailyCollectionQuery) {
    return this.reader.received(this.query(query, ['customer', 'loanNumber', 'amount'] as const));
  }
  async assignedSummary(date: string, actor: CurrentIdentity): Promise<DailyCollectionSummary> {
    this.assertAssignedDate(date);
    const scope = await this.assignedScope(actor);
    return { date, ...await this.reader.summary(date, scope) };
  }
  async assignedDue(query: DailyCollectionQuery, actor: CurrentIdentity) {
    this.assertAssignedDate(query.date);
    const scope = await this.assignedScope(actor);
    return this.reader.due(this.query(query, ['customer', 'loanNumber', 'sequence', 'dueDate', 'pendingAmount'] as const), scope);
  }
  async assignedReceived(query: DailyCollectionQuery, actor: CurrentIdentity) {
    this.assertAssignedDate(query.date);
    const scope = await this.assignedScope(actor);
    return this.reader.received(this.query(query, ['customer', 'loanNumber', 'amount'] as const), scope);
  }
  private async assignedScope(actor: CurrentIdentity): Promise<DailyCollectionsScope> {
    if (actor.role.isSuperAdmin) return { kind: 'ALL' };
    if (actor.role.code !== 'COLLECTOR' || !await this.reader.resolveCollector(actor.id))
      throw new DailyCollectionsForbiddenError('El usuario autenticado no posee un perfil de cobrador activo.');
    return { kind: 'COLLECTOR', collectorUserId: actor.id };
  }
  private assertAssignedDate(date: string) {
    if (!validDate(date) || date !== costaRicaEconomicDate(this.now()))
      throw new DailyCollectionsValidationError('Cobros del día sólo permite consultar la fecha actual.');
  }
}
import type { CurrentIdentity } from '../../domain/security/security.types';
import { costaRicaEconomicDate } from './collection-agenda.use-case';
