import type { CollectorCustodyDirection, CollectorCustodyEntry, CollectorCustodySummary } from '../../domain/collector-custody/collector-custody.types';

export type CollectorCustodyCommand = {
  collectorId?: string;
  amount: string;
  effectiveDate: string;
  paymentMethodId: string;
  reference: string;
  reason: string;
  notes?: string | null;
  direction?: CollectorCustodyDirection;
  idempotencyKey: string;
};
export interface CollectorCustodyStore {
  summary(actorUserId: string, collectorId: string | undefined, allowGlobal: boolean): Promise<CollectorCustodySummary>;
  history(actorUserId: string, collectorId: string | undefined, allowGlobal: boolean): Promise<CollectorCustodyEntry[]>;
  record(kind: 'remittance' | 'topup' | 'adjustment', command: CollectorCustodyCommand, fingerprint: string,
    actorUserId: string, allowGlobal: boolean): Promise<CollectorCustodyEntry>;
}
export interface CollectorCustodyClock { today(): string; }
