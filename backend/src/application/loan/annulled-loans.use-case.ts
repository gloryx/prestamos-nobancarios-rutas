import { cents } from '../../domain/loan/loan-financial-integrity';
import { paymentFingerprint } from '../../domain/payment/payment-rules';
import { isDateOnly } from './uncollectible-eligibility.use-case';

export type DisbursementResolution = 'NOT_DELIVERED' | 'RETURNED_IN_FULL';
export type AnnulledLoanQuery = { page: number; pageSize: number; search?: string; startDate?: string; endDate?: string;
  sortBy?: 'loanNumber' | 'customer' | 'startDate' | 'annulledDate' | 'principal' | 'interest' | 'contractualTotal'; sortDir?: 'asc' | 'desc' };
export type AnnulledLoanRow = { loanId: string; loanNumber: string; customerId: string; identification: string; fullName: string;
  startDate: string; principal: string; interestAmount: string; totalAmount: string; disbursementId: string | null;
  disbursementAmount: string | null; disbursementDate: string | null; disbursementMethodId: string | null;
  cashId: string | null; cashAmount: string | null; cashDate: string | null; cashMethodId: string | null;
  cashDirection: string | null; cashConcept: string | null; reversalId: string | null; reversalAmount: string | null;
  reversalDate: string | null; reversalMethodId: string | null; reversalDirection: string | null; reversalConcept: string | null;
  reversalActorId: string | null; reversalKey: string | null; reversalFingerprint: string | null;
  eventId: string | null; eventSequence: number | null; eventKind: string | null; fromStatus: string | null;
  toStatus: string | null; annulledAt: string | null; annulledBusinessDate: string | null; reason: string | null;
  actorId: string | null; disbursementResolution: string | null; eventFingerprint: string | null };
export interface AnnulledLoansReader { read(kind: 'annullable' | 'annulled', search?: string): Promise<AnnulledLoanRow[]> }
export const ANNULLED_LOANS_READER = Symbol('ANNULLED_LOANS_READER');
export class AnnulledLoansValidationError extends Error {}
export class AnnulledLoansIntegrityError extends Error {}
const validMoney = (v: unknown): v is string => typeof v === 'string' && /^\d+(?:\.\d{1,2})?$/.test(v);
const money = (v: bigint) => `${v / 100n}.${(v % 100n).toString().padStart(2, '0')}`;
const invalid = (row: AnnulledLoanRow) => new AnnulledLoansIntegrityError(`Invalid annulled loan ledger for ${row.loanId}.`);

export function assertDisbursement(row: AnnulledLoanRow, reversed: boolean): void {
  if (!row.loanId || !/^\d+$/.test(row.loanNumber) || !row.customerId || typeof row.fullName !== 'string' ||
    typeof row.identification !== 'string' || !isDateOnly(row.startDate) || !validMoney(row.principal) ||
    !validMoney(row.interestAmount) || !validMoney(row.totalAmount) || cents(row.principal) <= 0n ||
    cents(row.totalAmount) !== cents(row.principal) + cents(row.interestAmount) || !row.disbursementId ||
    !validMoney(row.disbursementAmount) || cents(row.disbursementAmount) !== cents(row.principal) ||
    !isDateOnly(row.disbursementDate) || row.disbursementDate !== row.startDate || !row.disbursementMethodId ||
    !row.cashId || row.cashDirection !== 'OUTFLOW' || row.cashConcept !== 'LOAN_DISBURSEMENT' ||
    !validMoney(row.cashAmount) || cents(row.cashAmount) !== cents(row.principal) ||
    row.cashMethodId !== row.disbursementMethodId || row.cashDate !== row.disbursementDate ||
    (reversed && (!row.reversalId || row.reversalDirection !== 'INFLOW' || row.reversalConcept !== 'REVERSAL' ||
      !validMoney(row.reversalAmount) || cents(row.reversalAmount) !== cents(row.principal) ||
      row.reversalMethodId !== row.cashMethodId || row.reversalDate !== row.annulledBusinessDate ||
      row.reversalActorId !== row.actorId || row.reversalKey !== `loan-annulment:${row.eventId}` ||
      row.reversalFingerprint !== row.eventFingerprint))) throw invalid(row);
}

export function assertAnnulledEvent(row: AnnulledLoanRow): void {
  if (!row.eventId || !Number.isSafeInteger(row.eventSequence) || row.eventSequence! < 2 ||
    row.eventKind !== 'TRANSITION' || row.fromStatus !== 'ACTIVE' || row.toStatus !== 'ANNULLED' ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z$/.test(row.annulledAt ?? '') ||
    !isDateOnly(row.annulledBusinessDate) || !row.actorId || typeof row.reason !== 'string' ||
    row.reason.trim() !== row.reason || row.reason.length < 1 || row.reason.length > 500 ||
    !['NOT_DELIVERED', 'RETURNED_IN_FULL'].includes(row.disbursementResolution ?? '') ||
    row.eventFingerprint !== paymentFingerprint({ operation: 'ANNUL_LOAN', loanId: row.loanId, actorId: row.actorId,
      reason: row.reason, disbursementResolution: row.disbursementResolution! })) throw invalid(row);
  assertDisbursement(row, true);
}

export class ListAnnulledLoansUseCase {
  constructor(private readonly reader: AnnulledLoansReader) {}
  async execute(kind: 'annullable' | 'annulled', query: AnnulledLoanQuery) {
    const sorts = ['loanNumber', 'customer', 'startDate', 'principal', 'interest', 'contractualTotal', ...(kind === 'annulled' ? ['annulledDate'] : [])];
    if (!Number.isSafeInteger(query.page) || query.page < 1 || ![10, 20, 50].includes(query.pageSize) ||
      !Number.isSafeInteger(query.page * query.pageSize) ||
      (query.startDate !== undefined && !isDateOnly(query.startDate)) ||
      (query.endDate !== undefined && !isDateOnly(query.endDate)) ||
      (query.startDate && query.endDate && query.startDate > query.endDate) ||
      (query.sortBy !== undefined && !sorts.includes(query.sortBy)) ||
      (query.sortDir !== undefined && !['asc', 'desc'].includes(query.sortDir))) {
      throw new AnnulledLoansValidationError('Los filtros de préstamos no son válidos.');
    }
    const rows = await this.reader.read(kind, query.search?.trim());
    for (const row of rows) {
      if (kind === 'annulled') {
        assertAnnulledEvent(row);
      } else {
        assertDisbursement(row, false);
      }
    }
    const filtered = rows.filter((row) => {
      const date = kind === 'annulled' ? row.annulledBusinessDate! : row.startDate;
      return (!query.startDate || date >= query.startDate) && (!query.endDate || date <= query.endDate);
    });
    const key = query.sortBy ?? (kind === 'annulled' ? 'annulledDate' : 'loanNumber');
    const value = (row: AnnulledLoanRow): bigint | string => {
      switch (key) {
        case 'loanNumber': return BigInt(row.loanNumber);
        case 'customer': return row.fullName.toLowerCase();
        case 'startDate': return row.startDate;
        case 'annulledDate': return row.annulledAt!;
        case 'principal': return cents(row.principal);
        case 'interest': return cents(row.interestAmount);
        default: return cents(row.totalAmount);
      }
    };
    const compare = (a: string | bigint, b: string | bigint) => a < b ? -1 : a > b ? 1 : 0;
    filtered.sort((a, b) => compare(value(a), value(b)) * (query.sortDir === 'asc' ? 1 : -1) ||
      compare(BigInt(a.loanNumber), BigInt(b.loanNumber)) || compare(a.loanId, b.loanId));
    const summary = filtered.reduce((sum, row) => ({ capital: sum.capital + cents(row.principal),
      interest: sum.interest + cents(row.interestAmount), contractualTotal: sum.contractualTotal + cents(row.totalAmount) }),
    { capital: 0n, interest: 0n, contractualTotal: 0n });
    const items = filtered.slice((query.page - 1) * query.pageSize, query.page * query.pageSize).map((row) => ({
      loanId: row.loanId, loanNumber: row.loanNumber,
      customer: { id: row.customerId, identification: row.identification, fullName: row.fullName },
      startDate: row.startDate, principal: row.principal, interestAmount: row.interestAmount, totalAmount: row.totalAmount,
      status: kind === 'annulled' ? 'ANNULLED' : 'ACTIVE',
      disbursement: { id: row.disbursementId!, amount: row.disbursementAmount!, date: row.disbursementDate! },
      ...(kind === 'annulled' && { annulledAt: row.annulledAt!, annulledBusinessDate: row.annulledBusinessDate!,
        reason: row.reason!, actorId: row.actorId!, disbursementResolution: row.disbursementResolution as DisbursementResolution }),
    }));
    return { items, total: filtered.length, page: query.page, pageSize: query.pageSize,
      summary: { total: filtered.length, capital: money(summary.capital), interest: money(summary.interest),
        contractualTotal: money(summary.contractualTotal) } };
  }
}
