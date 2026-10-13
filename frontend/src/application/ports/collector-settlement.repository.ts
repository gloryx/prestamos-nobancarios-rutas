import type { CollectorSettlementDetail } from '../../domain/entities/collector-settlement';

export type CreateCollectorSettlementInput = { collectorId?: string; precollectionIds: string[]; idempotencyKey: string };
export type CollectorSettlementActionInput = { idempotencyKey: string };
export type CollectorSettlementReasonedActionInput = { reason: string; idempotencyKey: string };
export type ConfirmCollectorSettlementInput = {
  amountDelivered: string;
  deliveryDate: string;
  deliveryPaymentMethodId: string | null;
  deliveryReference: string | null;
  deliveryNotes: string | null;
  idempotencyKey: string;
};

export interface CollectorSettlementRepository {
  create(input: CreateCollectorSettlementInput): Promise<CollectorSettlementDetail>;
  mine(): Promise<CollectorSettlementDetail[]>;
  list(): Promise<CollectorSettlementDetail[]>;
  detail(id: string): Promise<CollectorSettlementDetail>;
  submit(id: string, input: CollectorSettlementActionInput): Promise<CollectorSettlementDetail>;
  review(id: string, input: CollectorSettlementActionInput): Promise<CollectorSettlementDetail>;
  reject(id: string, input: CollectorSettlementReasonedActionInput): Promise<CollectorSettlementDetail>;
  cancel(id: string, input: CollectorSettlementReasonedActionInput): Promise<CollectorSettlementDetail>;
  confirm(id: string, input: ConfirmCollectorSettlementInput): Promise<CollectorSettlementDetail>;
}
