import type { CustomerExportItem } from '../../domain/entities/customer';
import { customerUseCases } from '../../app/customers';

export async function generateCustomerReport(): Promise<void> {
  const records = [...await customerUseCases.exportAll.execute()].sort((left, right) => left.fullName.localeCompare(right.fullName, 'es', { sensitivity: 'base' }));
  await writeCustomerReport(records, new Date());
}

export async function writeCustomerReport(records: CustomerExportItem[], now: Date): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape', format: 'letter', unit: 'mm' });
  const active = records.filter((customer) => customer.isActive).length;
  const inactive = records.length - active;
  doc.setFontSize(16); doc.text('Reporte de Clientes', 10, 14);
  doc.setFontSize(9); doc.text(`Fecha de generación: ${now.toLocaleDateString('es-CR')}`, 10, 21);
  doc.text(`Total de clientes: ${records.length}`, 10, 27);
  doc.text(`Clientes activos: ${active} | Clientes inactivos: ${inactive}`, 10, 33);
  autoTable(doc, {
    startY: 39,
    head: [['#', 'Identificación', 'Nombre completo', 'Teléfono', 'Provincia', 'Cantón', 'Distrito', 'Estado']],
    body: records.map((item, index) => [String(index + 1), item.identification, item.fullName, item.primaryPhone, item.province, item.canton, item.district, item.isActive ? 'ACTIVO' : 'INACTIVO']),
    styles: { fontSize: 7.5, overflow: 'linebreak', cellPadding: 1.8 },
    headStyles: { fillColor: [18, 53, 95], textColor: 255, fontStyle: 'bold' },
    alternateRowStyles: { fillColor: [242, 246, 250] },
    pageBreak: 'auto', showHead: 'everyPage',
    margin: { top: 10, right: 10, bottom: 14, left: 10 },
  });
  const pages = doc.getNumberOfPages();
  for (let page = 1; page <= pages; page += 1) {
    doc.setPage(page); doc.setFontSize(8);
    doc.text(`Página ${page} de ${pages}`, doc.internal.pageSize.getWidth() - 10, doc.internal.pageSize.getHeight() - 6, { align: 'right' });
  }
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  doc.save(`clientes_${localDate}.pdf`);
}
