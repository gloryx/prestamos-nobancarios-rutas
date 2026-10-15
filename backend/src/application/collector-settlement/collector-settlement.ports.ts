import type { CollectorSettlementDetail, EligibleCollectorPrecollectionPage } from '../../domain/collector-settlement/collector-settlement.types';

export type CreateCollectorSettlementCommand = {
  collectorId?: string;
  precollectionIds: string[];
  idempotencyKey: string;
};
export type ConfirmCollectorSettlementCommand = {
  amountDelivered: string;
  deliveryDate: string;
  deliveryPaymentMethodId: string | null;
  deliveryReference: string | null;
  deliveryNotes: string | null;
  idempotencyKey: string;
};
export type CollectorSettlementDeliveryMethod = { id: string; name: string };

export interface CollectorSettlementStore {
  create(command: CreateCollectorSettlementCommand, actorUserId: string, allowGlobal: boolean, fingerprint: string): Promise<CollectorSettlementDetail>;
  list(actorUserId?: string): Promise<CollectorSettlementDetail[]>;
  eligible(actorUserId: string, query: { page: number; pageSize: number }): Promise<EligibleCollectorPrecollectionPage>;
  activeDeliveryMethods(): Promise<CollectorSettlementDeliveryMethod[]>;
  detail(id: string, actorUserId?: string): Promise<CollectorSettlementDetail | null>;
  transition(id: string, action: 'submit' | 'review' | 'reject' | 'cancel', reason: string | null,
    idempotencyKey: string, fingerprint: string, actorUserId: string, allowGlobal: boolean): Promise<CollectorSettlementDetail>;
  confirm(id: string, command: ConfirmCollectorSettlementCommand, fingerprint: string,
    actorUserId: string): Promise<CollectorSettlementDetail>;
}

export interface CollectorSettlementClock { today(): string; }
