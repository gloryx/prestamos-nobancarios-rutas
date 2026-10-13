import type { CollectorCustodyAdjustmentInput, CollectorCustodyMovementInput, CollectorCustodyRepository } from '../../application/ports/collector-custody.repository';
import type { CollectorCustodyEntry, CollectorCustodySummary } from '../../domain/entities/collector-custody';
import { apiClient } from './api-client';

const query = (collectorId?: string) => collectorId ? `?${new URLSearchParams({ collectorId })}` : '';

export class CollectorCustodyApi implements CollectorCustodyRepository {
  summary(collectorId?: string): Promise<CollectorCustodySummary> {
    return apiClient.request(`/collector-custody/summary${query(collectorId)}`);
  }
  movements(collectorId?: string): Promise<CollectorCustodyEntry[]> {
    return apiClient.request(`/collector-custody/movements${query(collectorId)}`);
  }
  remit(input: CollectorCustodyMovementInput) { return this.record('remittances', input); }
  topUp(input: CollectorCustodyMovementInput) { return this.record('top-ups', input); }
  adjust(input: CollectorCustodyAdjustmentInput) { return this.record('adjustments', input); }
  private record(path: 'remittances' | 'top-ups' | 'adjustments', input: CollectorCustodyMovementInput | CollectorCustodyAdjustmentInput): Promise<CollectorCustodyEntry> {
    return apiClient.request(`/collector-custody/${path}`, { method: 'POST', body: JSON.stringify(input) });
  }
}
