import type { Collector } from '../../domain/entities/collector';
import type { CollectorListQuery } from '../../application/ports/collector.repository';

export async function generateCollectorReport(records: Collector[], filters: Pick<CollectorListQuery, 'search' | 'status'>): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF({ orientation: 'landscape' });
  const now = new Date();
  doc.setFontSize(15); doc.text('Lista de cobradores', 10, 14);
  doc.setFontSize(9); doc.text(`Fecha: ${now.toLocaleDateString('es-CR')} | Total: ${records.length}`, 10, 21);
  const status = filters.status === 'ACTIVE' ? 'Activos' : filters.status === 'INACTIVE' ? 'Inactivos' : 'Todos';
  doc.text(`Estado: ${status}`, 10, 27);
  const searchLines = filters.search.trim() ? doc.splitTextToSize(`Búsqueda: ${filters.search}`, doc.internal.pageSize.getWidth() - 20) as string[] : [];
  if (searchLines.length) doc.text(searchLines, 10, 33);
  autoTable(doc, {
    startY: searchLines.length ? 34 + searchLines.length * 4 : 32,
    head: [['Identificación', 'Cobrador', 'Teléfono', 'Usuario', 'Estado']],
    body: records.map((item) => [
      item.identification,
      [item.firstName, item.firstLastName, item.secondLastName].filter(Boolean).join(' '),
      item.phone,
      item.user?.username ?? 'SIN VINCULAR',
      item.isActive ? 'ACTIVO' : 'INACTIVO',
    ]),
    styles: { fontSize: 8, overflow: 'linebreak' },
    headStyles: { fillColor: [18, 53, 95] },
    pageBreak: 'auto', showHead: 'everyPage',
    margin: { top: 10, right: 10, bottom: 15, left: 10 },
  });
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  doc.save(`cobradores-${localDate}.pdf`);
}
