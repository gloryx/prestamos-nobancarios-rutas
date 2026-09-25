import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { PaymentFrequencyInput, PaymentFrequencyRepository } from '../../application/ports/payment-frequency.repository';

import { apiClient } from './api-client';
export class PaymentFrequencyApi implements PaymentFrequencyRepository {
  async list(): Promise<PaymentFrequency[]> { return this.request('/payment-frequencies'); }
  async get(id: string): Promise<PaymentFrequency> { return this.request(`/payment-frequencies/${id}`); }
  async create(input: PaymentFrequencyInput): Promise<PaymentFrequency> { return this.request('/payment-frequencies', { method: 'POST', body: JSON.stringify(input) }); }
  async update(id: string, input: Partial<PaymentFrequencyInput>): Promise<PaymentFrequency> { return this.request(`/payment-frequencies/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  async changeStatus(id: string, isActive: boolean): Promise<PaymentFrequency> { return this.request(`/payment-frequencies/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }); }
  private request<T>(path: string, options: RequestInit = {}): Promise<T> { return apiClient.request<T>(path, options); }
}
