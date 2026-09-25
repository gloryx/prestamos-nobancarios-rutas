import type { IntervalUnit, PaymentFrequency } from '../../domain/entities/payment-frequency';

export type PaymentFrequencyInput = { name: string; intervalUnit: IntervalUnit; intervalValue: number; order: number };
export interface PaymentFrequencyRepository { list(): Promise<PaymentFrequency[]>; get(id: string): Promise<PaymentFrequency>; create(input: PaymentFrequencyInput): Promise<PaymentFrequency>; update(id: string, input: Partial<PaymentFrequencyInput>): Promise<PaymentFrequency>; changeStatus(id: string, isActive: boolean): Promise<PaymentFrequency>; }
