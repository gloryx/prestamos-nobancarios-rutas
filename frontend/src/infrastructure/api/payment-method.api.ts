import type { PaymentMethod } from '../../domain/entities/payment-method';
import type { PaymentMethodInput, PaymentMethodRepository } from '../../application/ports/payment-method.repository';

import { apiClient } from './api-client';
export class PaymentMethodApi implements PaymentMethodRepository {
  async list(): Promise<PaymentMethod[]> { return this.request('/payment-methods'); }
  async get(id: string): Promise<PaymentMethod> { return this.request(`/payment-methods/${id}`); }
  async create(input: PaymentMethodInput): Promise<PaymentMethod> { return this.request('/payment-methods', { method: 'POST', body: JSON.stringify(input) }); }
  async update(id: string, input: PaymentMethodInput): Promise<PaymentMethod> { return this.request(`/payment-methods/${id}`, { method: 'PATCH', body: JSON.stringify(input) }); }
  async changeStatus(id: string, isActive: boolean): Promise<PaymentMethod> { return this.request(`/payment-methods/${id}/status`, { method: 'PATCH', body: JSON.stringify({ isActive }) }); }
  private request<T>(path: string, options: RequestInit = {}): Promise<T> { return apiClient.request<T>(path, options); }
}
