import type { LoanRefinancingOperations } from '../ports/loan-refinancing.repository';
import type { RefinancingConditions } from './refinancing-conditions';
import type { ConfirmRefinancingRequest, RefinancingPreview, RefinancingResult } from '../../domain/entities/loan-refinancing';
import type { LoanPlanEntry } from '../../domain/entities/loan';
import { moneyFromCents, parseMoneyCents } from '../../shared/utils/money';

export type RefinancingFailure = 'STALE_DATA' | 'ALREADY_REFINANCED' | 'IDEMPOTENCY_CONFLICT' |
  'CONCURRENT_REFINANCING' | 'HISTORICAL_BALANCE_CONFLICT' | 'CONFLICT' | 'INVALID' | 'FORBIDDEN' |
  'NOT_FOUND' | 'NETWORK' | 'SERVER';

export type RefinancingReview = {
  preview: RefinancingPreview;
  request: ConfirmRefinancingRequest;
  newPrincipal: string;
  newTotal: string;
  planTotal: string;
  difference: string;
  frequencyName: string;
  preferredMethodName: string;
  disbursementMethodName: string | null;
};

export type RefinancingConfirmationState = {
  prepared: RefinancingReview | null;
  submitting: boolean;
  failure: RefinancingFailure | null;
  result: RefinancingResult | null;
};

export function buildRefinancingReview(preview: RefinancingPreview, conditions: RefinancingConditions,
  plan: LoanPlanEntry[], newPrincipal: string, newTotal: string, frequencyName: string,
  preferredMethodName: string, disbursementMethodName: string | null,
): Omit<RefinancingReview, 'request'> & { request: Omit<ConfirmRefinancingRequest, 'idempotencyKey'> } {
  const amount = (value: string) => moneyFromCents(parseMoneyCents(value)!);
  const planCents = plan.reduce((sum, row) => sum + parseMoneyCents(row.pendingAmount)!, 0n);
  const planTotal = moneyFromCents(planCents);
  const difference = moneyFromCents(parseMoneyCents(newTotal)! - planCents);
  return { preview, newPrincipal, newTotal, planTotal, difference, frequencyName, preferredMethodName, disbursementMethodName,
    request: { originLoanId: preview.loanId, refinancingDate: conditions.refinancingDate,
      newMoney: amount(conditions.newMoney),
      ...(parseMoneyCents(conditions.newMoney)! > 0n ? { disbursementPaymentMethodId: conditions.disbursementPaymentMethodId } : {}),
      newInterestAmount: amount(conditions.newInterestAmount), paymentFrequencyId: conditions.paymentFrequencyId,
      preferredPaymentMethodId: conditions.preferredPaymentMethodId,
      ...(conditions.observations.trim() ? { observations: conditions.observations.trim() } : {}),
      plan: plan.map((row) => ({ sequence: row.sequence, dueDate: row.dueDate, pendingAmount: amount(row.pendingAmount) })),
      baseline: preview.baseline },
  };
}

export class RefinancingConfirmationController {
  private state: RefinancingConfirmationState = { prepared: null, submitting: false, failure: null, result: null };
  private readonly listeners = new Set<() => void>();
  private busy = false;
  private revision = 0;

  constructor(private readonly operations: LoanRefinancingOperations, private readonly newKey: () => string,
    private readonly classify: (error: unknown) => RefinancingFailure) {}

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  };
  getSnapshot = (): RefinancingConfirmationState => this.state;

  private update(changes: Partial<RefinancingConfirmationState>): void {
    this.state = { ...this.state, ...changes };
    this.listeners.forEach((listener) => listener());
  }

  prepare(review: ReturnType<typeof buildRefinancingReview>): boolean {
    if (this.busy || this.state.result) return false;
    const current = this.state.prepared?.request;
    const previous = current && { ...current, idempotencyKey: undefined };
    const key = current && JSON.stringify(previous) === JSON.stringify(review.request) ? current.idempotencyKey : this.newKey();
    this.update({ prepared: { ...review, request: { ...review.request, idempotencyKey: key } }, failure: null });
    return true;
  }

  async confirm(allowed: boolean): Promise<'SUCCESS' | RefinancingFailure | null> {
    if (!allowed || this.busy || !this.state.prepared || this.state.prepared.difference !== '0.00' || this.state.result) return null;
    this.busy = true;
    const revision = this.revision;
    const request = this.state.prepared.request;
    this.update({ submitting: true, failure: null });
    try {
      const result = await this.operations.confirm(request);
      if (revision !== this.revision) return null;
      this.update({ submitting: false, prepared: null, result });
      return 'SUCCESS';
    } catch (error) {
      if (revision !== this.revision) return null;
      const failure = this.classify(error);
      this.update({ submitting: false, failure });
      return failure;
    } finally {
      this.busy = false;
    }
  }

  invalidate(): void {
    if (this.busy) return;
    ++this.revision;
    this.update({ prepared: null, failure: null });
  }

  clearFailure(): void {
    if (this.state.failure) this.update({ failure: null });
  }

  reset(): void {
    if (this.busy) return;
    ++this.revision;
    this.update({ prepared: null, submitting: false, failure: null, result: null });
  }

  dispose(): void {
    ++this.revision;
    this.listeners.clear();
  }
}
