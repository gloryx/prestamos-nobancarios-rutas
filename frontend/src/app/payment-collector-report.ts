import { PaymentCollectorReportController } from '../application/use-cases/payment-collector-report-controller';
import { paymentCollectorReportApi } from '../infrastructure/api/payment-collector-report.api';
import { costaRicaDateOnly } from '../shared/utils/date';

export const createPaymentCollectorReport = () => new PaymentCollectorReportController(paymentCollectorReportApi, costaRicaDateOnly);
