import type { PaymentMethod } from '../../domain/entities/payment-method';

export async function generatePaymentMethodReport(methods: PaymentMethod[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF();
  const now = new Date();
  const date = now.toLocaleDateString('es-CR');
  doc.setFontSize(15); doc.text('Sistema de Préstamos No Bancarios', 10, 12);
  doc.setFontSize(11); doc.text('Reporte de formas de pago', 10, 20); doc.setFontSize(9); doc.text(`Fecha: ${date} | Total: ${methods.length}`, 10, 26);
  autoTable(doc, { head: [['Nombre', 'Orden', 'Estado']], body: methods.map((item) => [item.name, String(item.order), item.isActive ? 'Activa' : 'Inactiva']), pageBreak: 'auto', showHead: 'everyPage', margin: { top: 30, right: 10, bottom: 20, left: 10 } });
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  doc.save(`formas-de-pago-${localDate}.pdf`);
}
