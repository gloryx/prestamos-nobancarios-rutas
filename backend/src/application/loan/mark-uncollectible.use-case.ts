import { paymentFingerprint } from '../../domain/payment/payment-rules';
import type { LoanStatusHistory } from '../../domain/loan/loan.types';
import type { LoanFinancialTotalsQuery } from './loan-financial-totals.reader';
import { getNextLoanStatusEventSequence, LoanStatusHistorySequenceError } from './loan-status-history-sequence';
import { EvaluateUncollectibleEligibilityUseCase } from './uncollectible-eligibility.use-case';

export class MarkUncollectibleValidationError extends Error {}
export class MarkUncollectibleConflictError extends Error {}
export class MarkUncollectibleNotFoundError extends Error {}

export type UncollectibleEvent = Pick<LoanStatusHistory, 'id' | 'loanId' | 'eventSequence' | 'eventKind' | 'fromStatus' | 'toStatus' | 'changedAt' | 'changedByUserId' | 'reason' | 'idempotencyFingerprint'>;
export interface MarkUncollectibleTransaction {
  executor: LoanFinancialTotalsQuery;
  lockLoan(id: string): Promise<{ id: string; status: string } | undefined>;
  findByKey(key: string): Promise<UncollectibleEvent | undefined>;
  updateActiveLoan(id: string): Promise<boolean>;
  insertEvent(loanId: string, sequence: number, actorId: string, reason: string, key: string, fingerprint: string): Promise<UncollectibleEvent | undefined>;
}
export interface MarkUncollectibleWriter {
  transaction<T>(run: (tx: MarkUncollectibleTransaction) => Promise<T>): Promise<T>;
}
export const MARK_UNCOLLECTIBLE_WRITER = Symbol('MARK_UNCOLLECTIBLE_WRITER');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[\x21-\x7e]{1,128}$/;
const keyConflict = () => new MarkUncollectibleConflictError('La clave de idempotencia ya fue utilizada con otros datos.');
const projection = (event: UncollectibleEvent) => ({ loanId: event.loanId, status: 'UNCOLLECTIBLE' as const,
  event: { id: event.id, sequence: event.eventSequence, changedAt: event.changedAt } });

export class MarkUncollectibleUseCase {
  constructor(private readonly writer: MarkUncollectibleWriter, private readonly eligibility: EvaluateUncollectibleEligibilityUseCase) {}

  async execute(loanId: string, input: { reason: string; idempotencyKey: string }, actorId: string) {
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    const key = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (!UUID.test(loanId) || !reason || !KEY.test(key)) throw new MarkUncollectibleValidationError('Los datos para marcar el préstamo como incobrable no son válidos.');
    const today = new Date().toISOString().slice(0, 10);
    return this.writer.transaction(async (tx) => {
      const locked = await tx.lockLoan(loanId);
      if (!locked) throw new MarkUncollectibleNotFoundError('El préstamo no existe.');
      if (locked.id.toLowerCase() !== loanId.toLowerCase()) throw new MarkUncollectibleConflictError('El préstamo cambió durante la operación.');
      const fingerprint = paymentFingerprint({ loanId: locked.id, operation: 'MARK_UNCOLLECTIBLE', reason, actorId });
      const existing = await tx.findByKey(key);
      if (existing) {
        if (existing.loanId !== locked.id || existing.eventKind !== 'TRANSITION' || existing.fromStatus !== 'ACTIVE'
          || existing.toStatus !== 'UNCOLLECTIBLE' || existing.changedByUserId !== actorId || existing.reason !== reason
          || existing.idempotencyFingerprint !== fingerprint) throw keyConflict();
        return projection(existing);
      }
      const eligibility = await this.eligibility.evaluate(tx.executor, locked.id, today);
      if (!eligibility.canMarkUncollectible) {
        if (eligibility.blockingReason === 'LOAN_NOT_OVERDUE') throw new MarkUncollectibleValidationError('El préstamo todavía no tiene obligaciones vencidas.');
        throw new MarkUncollectibleConflictError('El préstamo no cumple las condiciones para marcarlo como incobrable.');
      }
      let sequence: number;
      try { sequence = await getNextLoanStatusEventSequence(tx.executor, locked.id); }
      catch (error) {
        if (error instanceof LoanStatusHistorySequenceError) throw new MarkUncollectibleConflictError('El historial del préstamo no está disponible.');
        throw error;
      }
      if (sequence === 1) throw new MarkUncollectibleConflictError('El historial del préstamo no está disponible.');
      if (!await tx.updateActiveLoan(locked.id)) throw new MarkUncollectibleConflictError('El estado del préstamo cambió durante la operación.');
      const event = await tx.insertEvent(locked.id, sequence, actorId, reason, key, fingerprint);
      if (!event) throw keyConflict();
      return projection(event);
    });
  }
}
