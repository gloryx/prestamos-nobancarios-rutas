import type { PaymentMethod } from '../../domain/entities/payment-method';
import type { PaymentMethodInput, PaymentMethodRepository } from '../ports/payment-method.repository';

export class ListPaymentMethods { constructor(private readonly repository: PaymentMethodRepository) {} execute(): Promise<PaymentMethod[]> { return this.repository.list(); } }
export class CreatePaymentMethod { constructor(private readonly repository: PaymentMethodRepository) {} execute(input: PaymentMethodInput): Promise<PaymentMethod> { return this.repository.create(input); } }
export class UpdatePaymentMethod { constructor(private readonly repository: PaymentMethodRepository) {} execute(id: string, input: PaymentMethodInput): Promise<PaymentMethod> { return this.repository.update(id, input); } }
export class ChangePaymentMethodStatus { constructor(private readonly repository: PaymentMethodRepository) {} execute(id: string, active: boolean): Promise<PaymentMethod> { return this.repository.changeStatus(id, active); } }
