import type { PaymentFrequency } from '../../domain/entities/payment-frequency';
import type { PaymentFrequencyInput, PaymentFrequencyRepository } from '../ports/payment-frequency.repository';

export class ListPaymentFrequencies { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(): Promise<PaymentFrequency[]> { return this.repository.list(); } }
export class GetPaymentFrequency { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(id: string): Promise<PaymentFrequency> { return this.repository.get(id); } }
export class CreatePaymentFrequency { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(input: PaymentFrequencyInput): Promise<PaymentFrequency> { return this.repository.create(input); } }
export class UpdatePaymentFrequency { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(id: string, input: Partial<PaymentFrequencyInput>): Promise<PaymentFrequency> { return this.repository.update(id, input); } }
export class ChangePaymentFrequencyStatus { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(id: string, active: boolean): Promise<PaymentFrequency> { return this.repository.changeStatus(id, active); } }
