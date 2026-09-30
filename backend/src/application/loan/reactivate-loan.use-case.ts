import { paymentFingerprint } from '../../domain/payment/payment-rules';
import type { LoanFinancialTotalsQuery } from './loan-financial-totals.reader';
import { getNextLoanStatusEventSequence, LoanStatusHistorySequenceError } from './loan-status-history-sequence';
import type { UncollectibleEvent } from './mark-uncollectible.use-case';
import { EvaluateUncollectibleEligibilityUseCase } from './uncollectible-eligibility.use-case';

export class ReactivateLoanValidationError extends Error {}
export class ReactivateLoanConflictError extends Error {}
export class ReactivateLoanNotFoundError extends Error {}

export interface ReactivateLoanTransaction {
  executor: LoanFinancialTotalsQuery;
  lockLoan(id: string): Promise<{ id: string; status: string } | undefined>;
  findByKey(key: string): Promise<UncollectibleEvent | undefined>;
  updateUncollectibleLoan(id: string): Promise<boolean>;
  insertEvent(id: string, sequence: number, actor: string, reason: string, key: string, fingerprint: string): Promise<UncollectibleEvent | undefined>;
}
export interface ReactivateLoanWriter {
  transaction<T>(run: (tx: ReactivateLoanTransaction) => Promise<T>): Promise<T>;
}
export const REACTIVATE_LOAN_WRITER = Symbol('REACTIVATE_LOAN_WRITER');

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const KEY = /^[\x21-\x7e]{1,128}$/;
const keyConflict = () => new ReactivateLoanConflictError('La clave de idempotencia ya fue utilizada con otros datos.');
const projection = (event: UncollectibleEvent) => ({ loanId: event.loanId, status: 'ACTIVE' as const,
  event: { id: event.id, sequence: event.eventSequence, changedAt: event.changedAt } });

export class ReactivateLoanUseCase {
  constructor(private readonly writer: ReactivateLoanWriter, private readonly eligibility: EvaluateUncollectibleEligibilityUseCase) {}

  async execute(loanId: string, input: { reason: string; idempotencyKey: string }, actorId: string) {
    const reason = typeof input?.reason === 'string' ? input.reason.trim() : '';
    const key = typeof input?.idempotencyKey === 'string' ? input.idempotencyKey.trim() : '';
    if (!UUID.test(loanId) || !reason || !KEY.test(key)) throw new ReactivateLoanValidationError('Los datos para reactivar el préstamo no son válidos.');
    const today = new Date().toISOString().slice(0, 10);
    return this.writer.transaction(async (tx) => {
      const locked = await tx.lockLoan(loanId);
      if (!locked) throw new ReactivateLoanNotFoundError('El préstamo no existe.');
      if (locked.id.toLowerCase() !== loanId.toLowerCase()) throw new ReactivateLoanConflictError('El préstamo cambió durante la operación.');
      const fingerprint = paymentFingerprint({ loanId: locked.id, operation: 'REACTIVATE_LOAN', reason, actorId });
      const existing = await tx.findByKey(key);
      if (existing) {
        if (existing.loanId !== locked.id || existing.eventKind !== 'TRANSITION' || existing.fromStatus !== 'UNCOLLECTIBLE'
          || existing.toStatus !== 'ACTIVE' || existing.changedByUserId !== actorId || existing.reason !== reason
          || existing.idempotencyFingerprint !== fingerprint) throw keyConflict();
        return projection(existing);
      }
      if (locked.status !== 'UNCOLLECTIBLE') throw new ReactivateLoanConflictError('El préstamo no está marcado como incobrable.');
      const eligibility = await this.eligibility.evaluate(tx.executor, locked.id, today);
      if (eligibility.status !== 'UNCOLLECTIBLE' || !eligibility.isFinanciallyValid || eligibility.financialBalance <= 0n
        || !eligibility.firstOperationalRow) throw new ReactivateLoanConflictError('El préstamo no cumple las condiciones para reactivarlo.');
      let sequence: number;
      try { sequence = await getNextLoanStatusEventSequence(tx.executor, locked.id); }
      catch (error) {
        if (error instanceof LoanStatusHistorySequenceError) throw new ReactivateLoanConflictError('El historial del préstamo no está disponible.');
        throw error;
      }
      if (sequence === 1) throw new ReactivateLoanConflictError('El historial del préstamo no está disponible.');
      if (!await tx.updateUncollectibleLoan(locked.id)) throw new ReactivateLoanConflictError('El estado del préstamo cambió durante la operación.');
      const event = await tx.insertEvent(locked.id, sequence, actorId, reason, key, fingerprint);
      if (!event) throw keyConflict();
      return projection(event);
    });
  }
}
