import type { PaymentHistoryController, PaymentHistoryState } from '../../application/use-cases/payment-history-controller';
import { generatePaymentHistoryReport } from '../../infrastructure/reports/payment-history-report.service';
import { costaRicaDateOnly } from '../../shared/utils/date';

export async function exportPaymentHistory(controller: PaymentHistoryController, snapshot: PaymentHistoryState,
  report: typeof generatePaymentHistoryReport = generatePaymentHistoryReport): Promise<void> {
  const items = await controller.exportItems({ ...snapshot.filters, sortBy: snapshot.sortBy, sortDir: snapshot.sortDir });
  await report(items, snapshot.filters, snapshot.options, costaRicaDateOnly());
}
