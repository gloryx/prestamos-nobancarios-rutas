export type PaymentHistorySort = 'paymentDate' | 'customer' | 'loanNumber' | 'amount' | 'status' | 'principalApplied' | 'interestApplied';
export type PaymentHistoryQuery = { startDate?: string; endDate?: string; search?: string; loanNumber?: string;
  status?: string; paymentMethodId?: string; collectorId?: string; sortBy?: string; sortDir?: string;
  page?: number; pageSize?: number };
export type ValidPaymentHistoryQuery = Omit<PaymentHistoryQuery, 'status' | 'sortBy' | 'sortDir' | 'page' | 'pageSize'> & {
  status?: 'VALID' | 'ANNULLED'; sortBy: PaymentHistorySort; sortDir: 'asc' | 'desc'; page: number; pageSize: number };
export type PaymentHistoryItem = { paymentId: string; paymentDate: string; amount: string; principalApplied: string;
  interestApplied: string; status: 'VALID' | 'ANNULLED'; installments: number[];
  loan: { id: string; loanNumber: string }; customer: { id: string; identification: string; fullName: string; primaryPhone: string };
  paymentMethod: { id: string; name: string }; collector: { id: string; name: string } | null };
export type PaymentHistorySummary = { validPaymentsCount: number; receivedAmount: string;
  principalAppliedAmount: string; interestAppliedAmount: string };
export type PaymentHistoryResult = { items: PaymentHistoryItem[]; total: number; page: number; pageSize: number;
  summary: PaymentHistorySummary };
export type PaymentHistoryOptions = { paymentMethods: Array<{ id: string; name: string; active: boolean }>;
  collectors: Array<{ id: string; name: string; active: boolean }> };
export interface PaymentHistoryReader {
  list(query: ValidPaymentHistoryQuery): Promise<PaymentHistoryResult>;
  options(): Promise<PaymentHistoryOptions>;
}
export const PAYMENT_HISTORY_READER = Symbol('PAYMENT_HISTORY_READER');
export class PaymentHistoryValidationError extends Error {}

function validDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year > 0 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}

export class PaymentHistoryUseCase {
  constructor(private readonly reader: PaymentHistoryReader) {}
  list(query: PaymentHistoryQuery): Promise<PaymentHistoryResult> {
    const page = query.page ?? 1, pageSize = query.pageSize ?? 20;
    const sorts: PaymentHistorySort[] = ['paymentDate', 'customer', 'loanNumber', 'amount', 'status', 'principalApplied', 'interestApplied'];
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if ((query.startDate !== undefined && !validDate(query.startDate)) ||
      (query.endDate !== undefined && !validDate(query.endDate)) ||
      (query.startDate && query.endDate && query.startDate > query.endDate) ||
      (query.search !== undefined && (typeof query.search !== 'string' || query.search.length > 200)) ||
      (query.loanNumber !== undefined && !/^[1-9]\d{0,18}$/.test(query.loanNumber)) ||
      (query.status !== undefined && query.status !== 'VALID' && query.status !== 'ANNULLED') ||
      (query.paymentMethodId !== undefined && !uuid.test(query.paymentMethodId)) ||
      (query.collectorId !== undefined && !uuid.test(query.collectorId)) ||
      (query.sortBy !== undefined && !sorts.includes(query.sortBy as PaymentHistorySort)) ||
      (query.sortDir !== undefined && query.sortDir !== 'asc' && query.sortDir !== 'desc') ||
      !Number.isSafeInteger(page) || page < 1 || !Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 100 ||
      !Number.isSafeInteger((page - 1) * pageSize)) {
      throw new PaymentHistoryValidationError('Los filtros del historial de pagos no son válidos.');
    }
    return this.reader.list({ ...query, ...(query.search?.trim() ? { search: query.search.trim() } : { search: undefined }),
      page, pageSize, sortBy: (query.sortBy ?? 'paymentDate') as PaymentHistorySort,
      sortDir: (query.sortDir ?? 'desc') as 'asc' | 'desc', status: query.status as 'VALID' | 'ANNULLED' | undefined });
  }
  options(): Promise<PaymentHistoryOptions> { return this.reader.options(); }
}
