import type { IntervalUnit, PaymentFrequency } from '../../domain/payment-frequency/payment-frequency.types';

export type CreatePaymentFrequency = { name: string; intervalUnit: IntervalUnit; intervalValue: number; order: number };
export type UpdatePaymentFrequency = Partial<CreatePaymentFrequency>;

export interface PaymentFrequencyRepository {
  findAll(): Promise<PaymentFrequency[]>;
  findById(id: string): Promise<PaymentFrequency | null>;
  create(input: CreatePaymentFrequency): Promise<PaymentFrequency>;
  update(id: string, input: UpdatePaymentFrequency): Promise<PaymentFrequency | null>;
  updateStatus(id: string, isActive: boolean): Promise<PaymentFrequency | null>;
}

export const PAYMENT_FREQUENCY_REPOSITORY = Symbol('PAYMENT_FREQUENCY_REPOSITORY');
