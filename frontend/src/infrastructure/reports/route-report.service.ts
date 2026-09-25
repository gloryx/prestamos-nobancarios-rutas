import type { Route } from '../../domain/entities/route';

export async function generateRouteReport(routes: Route[]): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF();
  const now = new Date();
  doc.setFontSize(15); doc.text('Sistema de Préstamos No Bancarios', 10, 12);
  doc.setFontSize(11); doc.text('Reporte de rutas', 10, 20); doc.setFontSize(9); doc.text(`Fecha: ${now.toLocaleDateString('es-CR')} | Total: ${routes.length}`, 10, 26);
  autoTable(doc, { head: [['Nombre', 'Estado']], body: routes.map((route) => [route.name, route.isActive ? 'Activa' : 'Inactiva']), pageBreak: 'auto', showHead: 'everyPage', margin: { top: 30, right: 10, bottom: 20, left: 10 } });
  const localDate = [now.getFullYear(), String(now.getMonth() + 1).padStart(2, '0'), String(now.getDate()).padStart(2, '0')].join('-');
  doc.save(`rutas-${localDate}.pdf`);
}
