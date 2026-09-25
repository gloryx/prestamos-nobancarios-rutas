import type { PaymentFrequency } from '../../domain/entities/payment-frequency';

export function formatPaymentFrequency(item: Pick<PaymentFrequency, 'intervalUnit' | 'intervalValue'>): string {
  const labels = { DAY: ['día', 'días'], WEEK: ['semana', 'semanas'], MONTH: ['mes', 'meses'] } as const;
  const label = labels[item.intervalUnit][item.intervalValue === 1 ? 0 : 1];
  return `Cada ${item.intervalValue} ${label}`;
}

export async function generatePaymentFrequencyReport(frequencies: PaymentFrequency[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF();
  const now = new Date();
  const date = now.toLocaleDateString('es-CR');
  doc.setFontSize(15); doc.text('Sistema de Préstamos No Bancarios', 10, 12);
  doc.setFontSize(11); doc.text('Reporte de periodicidades de pago', 10, 20); doc.setFontSize(9); doc.text(`Fecha: ${date} | Total: ${frequencies.length}`, 10, 26);
  autoTable(doc, { head: [['Nombre', 'Intervalo', 'Orden', 'Estado']], body: frequencies.map((item) => [item.name, formatPaymentFrequency(item), String(item.order), item.isActive ? 'Activa' : 'Inactiva']), pageBreak: 'auto', showHead: 'everyPage', margin: { top: 30, right: 10, bottom: 20, left: 10 } });
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  doc.save(`periodicidades-de-pago-${localDate}.pdf`);
}
