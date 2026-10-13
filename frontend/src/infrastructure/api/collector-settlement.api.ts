import type { CollectorSettlementActionInput, CollectorSettlementReasonedActionInput, CollectorSettlementRepository, ConfirmCollectorSettlementInput,
  CreateCollectorSettlementInput } from '../../application/ports/collector-settlement.repository';
import type { CollectorSettlementDetail } from '../../domain/entities/collector-settlement';
import { apiClient } from './api-client';

export class CollectorSettlementApi implements CollectorSettlementRepository {
  create(input: CreateCollectorSettlementInput): Promise<CollectorSettlementDetail> {
    return apiClient.request('/collector-settlements', { method: 'POST', body: JSON.stringify(input) });
  }
  mine(): Promise<CollectorSettlementDetail[]> { return apiClient.request('/collector-settlements/mine'); }
  list(): Promise<CollectorSettlementDetail[]> { return apiClient.request('/collector-settlements'); }
  detail(id: string): Promise<CollectorSettlementDetail> { return apiClient.request(`/collector-settlements/${encodeURIComponent(id)}`); }
  submit(id: string, input: CollectorSettlementActionInput) { return this.action(id, 'submit', input); }
  review(id: string, input: CollectorSettlementActionInput) { return this.action(id, 'review', input); }
  reject(id: string, input: CollectorSettlementReasonedActionInput) { return this.action(id, 'reject', input); }
  cancel(id: string, input: CollectorSettlementReasonedActionInput) { return this.action(id, 'cancel', input); }
  confirm(id: string, input: ConfirmCollectorSettlementInput): Promise<CollectorSettlementDetail> {
    return apiClient.request(`/collector-settlements/${encodeURIComponent(id)}/confirm`, { method: 'POST', body: JSON.stringify(input) });
  }
  private action(id: string, action: 'submit' | 'review' | 'reject' | 'cancel', input: CollectorSettlementActionInput | CollectorSettlementReasonedActionInput): Promise<CollectorSettlementDetail> {
    return apiClient.request(`/collector-settlements/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: JSON.stringify(input) });
  }
}
