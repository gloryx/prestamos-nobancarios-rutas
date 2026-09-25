import { ChangePaymentFrequencyStatus, CreatePaymentFrequency, GetPaymentFrequency, ListPaymentFrequencies, UpdatePaymentFrequency } from '../application/use-cases/payment-frequency.use-cases';
import { PaymentFrequencyApi } from '../infrastructure/api/payment-frequency.api';

const repository = new PaymentFrequencyApi();
export const paymentFrequencyUseCases = { list: new ListPaymentFrequencies(repository), get: new GetPaymentFrequency(repository), create: new CreatePaymentFrequency(repository), update: new UpdatePaymentFrequency(repository), changeStatus: new ChangePaymentFrequencyStatus(repository) };
