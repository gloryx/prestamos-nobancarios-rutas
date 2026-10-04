import { PaymentHistoryController } from '../application/use-cases/payment-history-controller';
import { paymentHistoryApi } from '../infrastructure/api/payment-history.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export const createPaymentHistory = () => new PaymentHistoryController(paymentHistoryApi, costaRicaDateOnly);
