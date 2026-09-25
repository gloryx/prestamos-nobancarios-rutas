import { PaymentFrequencyNotFoundError } from '../../domain/payment-frequency/payment-frequency.errors';
import type { PaymentFrequency } from '../../domain/payment-frequency/payment-frequency.types';
import type { CreatePaymentFrequency, PaymentFrequencyRepository, UpdatePaymentFrequency } from './payment-frequency.repository';

export class ListPaymentFrequenciesUseCase { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(): Promise<PaymentFrequency[]> { return this.repository.findAll(); } }
export class GetPaymentFrequencyUseCase {
  constructor(private readonly repository: PaymentFrequencyRepository) {}
  async execute(id: string): Promise<PaymentFrequency> { const item = await this.repository.findById(id); if (!item) throw new PaymentFrequencyNotFoundError(id); return item; }
}
export class CreatePaymentFrequencyUseCase { constructor(private readonly repository: PaymentFrequencyRepository) {} execute(input: CreatePaymentFrequency): Promise<PaymentFrequency> { return this.repository.create({ ...input, name: input.name.trim() }); } }
export class UpdatePaymentFrequencyUseCase {
  constructor(private readonly repository: PaymentFrequencyRepository) {}
  async execute(id: string, input: UpdatePaymentFrequency): Promise<PaymentFrequency> { const item = await this.repository.update(id, { ...input, name: input.name?.trim() }); if (!item) throw new PaymentFrequencyNotFoundError(id); return item; }
}
export class ChangePaymentFrequencyStatusUseCase {
  constructor(private readonly repository: PaymentFrequencyRepository) {}
  async execute(id: string, isActive: boolean): Promise<PaymentFrequency> { const item = await this.repository.updateStatus(id, isActive); if (!item) throw new PaymentFrequencyNotFoundError(id); return item; }
}
