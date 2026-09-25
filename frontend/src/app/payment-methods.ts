import { ChangePaymentMethodStatus, CreatePaymentMethod, ListPaymentMethods, UpdatePaymentMethod } from '../application/use-cases/payment-method.use-cases';
import { PaymentMethodApi } from '../infrastructure/api/payment-method.api';

const repository = new PaymentMethodApi();
export const paymentMethodUseCases = { list: new ListPaymentMethods(repository), create: new CreatePaymentMethod(repository), update: new UpdatePaymentMethod(repository), changeStatus: new ChangePaymentMethodStatus(repository) };
