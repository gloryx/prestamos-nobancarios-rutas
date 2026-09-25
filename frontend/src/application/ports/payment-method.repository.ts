import type { PaymentMethod } from '../../domain/entities/payment-method';

export type PaymentMethodInput = { name: string; order: number };
export interface PaymentMethodRepository { list(): Promise<PaymentMethod[]>; get(id: string): Promise<PaymentMethod>; create(input: PaymentMethodInput): Promise<PaymentMethod>; update(id: string, input: PaymentMethodInput): Promise<PaymentMethod>; changeStatus(id: string, isActive: boolean): Promise<PaymentMethod>; }
