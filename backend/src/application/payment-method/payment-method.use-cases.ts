import { PaymentMethodNotFoundError } from '../../domain/payment-method/payment-method.errors';
import type { PaymentMethod } from '../../domain/payment-method/payment-method.types';
import type { CreatePaymentMethod, PaymentMethodRepository, UpdatePaymentMethod } from './payment-method.repository';

export class ListPaymentMethodsUseCase { constructor(private readonly repository: PaymentMethodRepository) {} execute(): Promise<PaymentMethod[]> { return this.repository.findAll(); } }
export class GetPaymentMethodUseCase {
  constructor(private readonly repository: PaymentMethodRepository) {}
  async execute(id: string): Promise<PaymentMethod> { const item = await this.repository.findById(id); if (!item) throw new PaymentMethodNotFoundError(id); return item; }
}
export class CreatePaymentMethodUseCase { constructor(private readonly repository: PaymentMethodRepository) {} execute(input: CreatePaymentMethod): Promise<PaymentMethod> { return this.repository.create({ ...input, name: input.name.trim() }); } }
export class UpdatePaymentMethodUseCase {
  constructor(private readonly repository: PaymentMethodRepository) {}
  async execute(id: string, input: UpdatePaymentMethod): Promise<PaymentMethod> { const item = await this.repository.update(id, { ...input, name: input.name?.trim() }); if (!item) throw new PaymentMethodNotFoundError(id); return item; }
}
export class ChangePaymentMethodStatusUseCase {
  constructor(private readonly repository: PaymentMethodRepository) {}
  async execute(id: string, isActive: boolean): Promise<PaymentMethod> { const item = await this.repository.updateStatus(id, isActive); if (!item) throw new PaymentMethodNotFoundError(id); return item; }
}
