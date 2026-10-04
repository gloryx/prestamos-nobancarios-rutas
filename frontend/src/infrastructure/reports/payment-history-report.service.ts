import type { PaymentHistoryFilters, PaymentHistoryItem, PaymentHistoryOptions } from '../../domain/entities/payment-history';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRCForPdf } from '../../shared/utils/money';

export async function generatePaymentHistoryReport(items: PaymentHistoryItem[], filters: PaymentHistoryFilters,
  options: PaymentHistoryOptions | null, today: string): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape' });
  doc.setFontSize(15); doc.text('Historial de pagos', 10, 14);
  doc.setFontSize(9);
  const active = [filters.search && `Cliente: ${filters.search}`, filters.loanNumber && `Préstamo: #${filters.loanNumber}`,
    filters.status && `Estado: ${filters.status === 'VALID' ? 'Válidos' : 'Anulados'}`,
    filters.paymentMethodId && `Forma: ${options?.paymentMethods.find((item) => item.id === filters.paymentMethodId)?.name ?? filters.paymentMethodId}`,
    filters.collectorId && `Cobrador: ${options?.collectors.find((item) => item.id === filters.collectorId)?.name ?? filters.collectorId}`].filter(Boolean);
  const lines = doc.splitTextToSize(`Desde: ${formatDateOnlyForDisplay(filters.startDate)}   Hasta: ${formatDateOnlyForDisplay(filters.endDate)}${active.length ? `   ${active.join('   ')}` : ''}`,
    doc.internal.pageSize.getWidth() - 20) as string[];
  doc.text(lines, 10, 21);
  autoTable(doc, { startY: 24 + lines.length * 4, head: [['Fecha', 'Cliente', 'Préstamo', 'Cuota', 'Monto', 'Capital', 'Interés', 'Estado', 'Forma', 'Cobrador']],
    body: items.map((item) => [formatDateOnlyForDisplay(item.paymentDate), item.customer.fullName,
      `#${item.loan.loanNumber}`, item.installments.join(', ') || '—', formatCRCForPdf(item.amount),
      formatCRCForPdf(item.principalApplied), formatCRCForPdf(item.interestApplied),
      item.status === 'VALID' ? 'VÁLIDO' : 'ANULADO', item.paymentMethod.name, item.collector?.name ?? '—']),
    styles: { fontSize: 8, overflow: 'linebreak' }, headStyles: { fillColor: [18, 53, 95] },
    pageBreak: 'auto', showHead: 'everyPage', margin: { left: 10, right: 10, top: 12, bottom: 15 } });
  doc.save(`historial-pagos-${today}.pdf`);
}
