import type { CollectorCustodyDirection, CollectorCustodyEntry, CollectorCustodySummary } from '../../domain/entities/collector-custody';

export type CollectorCustodyMovementInput = {
  collectorId?: string;
  amount: string;
  effectiveDate: string;
  paymentMethodId: string;
  reference: string;
  reason: string;
  notes?: string;
  idempotencyKey: string;
};
export type CollectorCustodyAdjustmentInput = CollectorCustodyMovementInput & { direction: CollectorCustodyDirection };

export interface CollectorCustodyRepository {
  summary(collectorId?: string): Promise<CollectorCustodySummary>;
  movements(collectorId?: string): Promise<CollectorCustodyEntry[]>;
  remit(input: CollectorCustodyMovementInput): Promise<CollectorCustodyEntry>;
  topUp(input: CollectorCustodyMovementInput): Promise<CollectorCustodyEntry>;
  adjust(input: CollectorCustodyAdjustmentInput): Promise<CollectorCustodyEntry>;
}
