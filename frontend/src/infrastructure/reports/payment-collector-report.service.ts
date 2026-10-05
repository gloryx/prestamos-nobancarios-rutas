import type { PaymentCollectorReportFilters, PaymentCollectorReportResult } from '../../domain/entities/payment-collector-report';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCForPdf } from '../../shared/utils/money';

export async function generatePaymentCollectorReport(data: PaymentCollectorReportResult,
  filters: PaymentCollectorReportFilters, today: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape' });
  const collector = data.options.collectors.find((item) => item.id === filters.collectorId)?.name ?? 'Todos';
  const method = data.options.paymentMethods.find((item) => item.id === filters.paymentMethodId)?.name ?? 'Todas';
  doc.setFontSize(15); doc.text('Cobros por cobrador', 10, 14);
  doc.setFontSize(9);
  const lines = doc.splitTextToSize(`Desde: ${formatDateOnlyForDisplay(filters.fromDate)}   Hasta: ${formatDateOnlyForDisplay(filters.toDate)}   Cobrador: ${collector}   Forma de pago: ${method}`,
    doc.internal.pageSize.getWidth() - 20) as string[];
  doc.text(lines, 10, 21);
  doc.text(`Pagos: ${data.summary.paymentsCount}   Total: ${formatCRCForPdf(data.summary.totalReceived)}   Capital: ${formatCRCForPdf(data.summary.principalApplied)}   Interés: ${formatCRCForPdf(data.summary.interestApplied)}`, 10, 26 + lines.length * 4);
  autoTable(doc, { startY: 31 + lines.length * 4,
    head: [['Cobrador', 'Pagos', 'Clientes', 'Préstamos', 'Total', 'Capital', 'Interés', 'Promedio', 'Participación']],
    body: data.collectors.map((row) => [row.collectorName, row.paymentsCount, row.customersCount, row.loansCount,
      formatCRCForPdf(row.totalReceived), formatCRCForPdf(row.principalApplied), formatCRCForPdf(row.interestApplied),
      formatCRCForPdf(row.averagePayment), `${row.participationPercentage}%`]),
    styles: { fontSize: 8, overflow: 'linebreak' }, headStyles: { fillColor: [18, 53, 95] },
    pageBreak: 'auto', showHead: 'everyPage', margin: { left: 10, right: 10, top: 12, bottom: 15 } });
  doc.save(`cobros-por-cobrador-${today}.pdf`);
}
