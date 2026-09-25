import type { PaymentMethod } from '../../domain/payment-method/payment-method.types';

export type CreatePaymentMethod = { name: string; order: number };
export type UpdatePaymentMethod = Partial<CreatePaymentMethod>;

export interface PaymentMethodRepository {
  findAll(): Promise<PaymentMethod[]>;
  findById(id: string): Promise<PaymentMethod | null>;
  create(input: CreatePaymentMethod): Promise<PaymentMethod>;
  update(id: string, input: UpdatePaymentMethod): Promise<PaymentMethod | null>;
  updateStatus(id: string, isActive: boolean): Promise<PaymentMethod | null>;
}

export const PAYMENT_METHOD_REPOSITORY = Symbol('PAYMENT_METHOD_REPOSITORY');
