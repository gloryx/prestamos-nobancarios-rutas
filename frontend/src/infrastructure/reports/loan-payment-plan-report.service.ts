import type { LoanDetail } from '../../domain/entities/loan';
import type { CellHookData } from 'jspdf-autotable';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { drawPdfMoneyCell, getPdfMoneyColor, getPdfMoneyText } from './loan-payment-plan-pdf.helpers';

function openPdfPreview(doc: { output: (type: 'blob') => Blob }): void {
  const blobUrl = URL.createObjectURL(doc.output('blob'));
  const preview = window.open(blobUrl, '_blank');
  const revoke = () => URL.revokeObjectURL(blobUrl);
  preview?.addEventListener('load', revoke, { once: true });
  window.setTimeout(revoke, 60_000);
}

export async function generateLoanPaymentPlanReport(loan: LoanDetail): Promise<void> {
  const { jsPDF } = await import('jspdf');
  const { autoTable } = await import('jspdf-autotable');
  const doc = new jsPDF();
  doc.setCharSpace(0);
  doc.setFontSize(15);
  doc.text(`Plan de pago - préstamo ${loan.loanNumber}`, 10, 14);
  doc.setCharSpace(0);
  doc.setFontSize(9);
  doc.text(`Cliente: ${loan.customerName} · Identificación: ${loan.identification} · Inicio: ${formatDateOnlyForDisplay(loan.startDate)}`, 10, 21);

  doc.setCharSpace(0);
  autoTable(doc, {
    head: [['#', 'Vencimiento', 'Cobro programado', 'Pendiente']],
    body: loan.plan.map((entry) => [String(entry.sequence), formatDateOnlyForDisplay(entry.dueDate), getPdfMoneyText(entry.pendingAmount), getPdfMoneyText(entry.pendingAmount)]),
    startY: 28,
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 2 },
    columnStyles: { 0: { halign: 'center' }, 2: { halign: 'right' }, 3: { halign: 'right', textColor: getPdfMoneyColor('pending') } },
     willDrawCell: (data) => {
       doc.setCharSpace(0);
       if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) data.cell.text = [];
     },
    didDrawCell: (data: CellHookData) => {
      if (data.section === 'body' && (data.column.index === 2 || data.column.index === 3)) {
        const entry = loan.plan[data.row.index];
        drawPdfMoneyCell(doc, data.cell, entry.pendingAmount, data.column.index === 2 ? 'scheduled' : 'pending');
      }
    },
  });

  const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 35;
  const footerMoney = [loan.totalAmount, '0.00', loan.pendingTotal];
  doc.setCharSpace(0);
  autoTable(doc, {
    startY: finalY + 6,
    body: [['Cobros programados', getPdfMoneyText(footerMoney[0]), 'Pagado', getPdfMoneyText(footerMoney[1]), 'Pendiente', getPdfMoneyText(footerMoney[2])]],
    theme: 'plain',
    styles: { font: 'helvetica', fontSize: 8, cellPadding: 1.5, valign: 'middle' },
    columnStyles: {
      0: { fontStyle: 'bold', cellWidth: 31 }, 1: { halign: 'right', cellWidth: 30, textColor: getPdfMoneyColor('scheduled') },
      2: { fontStyle: 'bold', cellWidth: 18 }, 3: { halign: 'right', cellWidth: 25, textColor: getPdfMoneyColor('paid') },
      4: { fontStyle: 'bold', cellWidth: 18 }, 5: { halign: 'right', cellWidth: 25, textColor: getPdfMoneyColor('pending') },
    },
     willDrawCell: (data) => {
       doc.setCharSpace(0);
       if (data.section === 'body' && [1, 3, 5].includes(data.column.index)) data.cell.text = [];
     },
    didDrawCell: (data: CellHookData) => {
      const roles: Record<number, 'scheduled' | 'paid' | 'pending'> = { 1: 'scheduled', 3: 'paid', 5: 'pending' };
      const role = roles[data.column.index];
      if (role) drawPdfMoneyCell(doc, data.cell, footerMoney[(data.column.index - 1) / 2], role);
    },
  });

  doc.setCharSpace(0);
  openPdfPreview(doc);
}
