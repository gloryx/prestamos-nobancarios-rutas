import type { jsPDF } from 'jspdf';
import type { LoanOperationalDetail } from '../../domain/entities/loan';
import { numberCurrentPaymentPlan } from '../../domain/payment-plan-numbering';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { moneyFromCents, parseMoneyCents } from '../../shared/utils/money';
import { getPdfMoneyText } from './loan-payment-plan-pdf.helpers';

const WIDTH = 80;
const HEIGHT = 180;
const MARGIN = 4;
const CONTENT_BOTTOM = 165;
const ROW_HEIGHT = 8;
const SECTION_HEIGHT = 7;
const WATERMARK_ANGLE = 38;
const REFINANCED_WATERMARK_MARGIN = MARGIN + 1;
const REFINANCED_WATERMARK_MAX_FONT_SIZE = 30;
const STATUS_LABELS: Record<string, string> = {
  ACTIVE: 'ACTIVO', CANCELLED: 'CANCELADO', REFINANCED: 'REFINANCIADO',
  UNCOLLECTIBLE: 'INCOBRABLE', ANNULLED: 'ANULADO',
};

function openPdfPreview(doc: { output: (type: 'blob') => Blob }): void {
  const blobUrl = URL.createObjectURL(doc.output('blob'));
  const preview = window.open(blobUrl, '_blank');
  const revoke = () => URL.revokeObjectURL(blobUrl);
  if (!preview) { revoke(); return; }
  const releaseWhenClosed = window.setInterval(() => {
    if (!preview.closed) return;
    window.clearInterval(releaseWhenClosed);
    revoke();
  }, 1_000);
}

function dateKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function limitedLines(doc: jsPDF, text: string, maxLines: number): string[] {
  const lines = doc.splitTextToSize(text, WIDTH - 2 * MARGIN) as string[];
  if (lines.length <= maxLines) return lines;
  const visible = lines.slice(0, maxLines);
  let last = visible[maxLines - 1];
  while (doc.getTextWidth(`${last}...`) > WIDTH - 2 * MARGIN) last = last.slice(0, -1);
  visible[maxLines - 1] = `${last}...`;
  return visible;
}

export async function createLoanPaymentPlanDocument(loan: LoanOperationalDetail, now = new Date()): Promise<jsPDF> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: [WIDTH, HEIGHT], orientation: 'portrait' });
  doc.setCharSpace(0);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const fullNameLines = doc.splitTextToSize(loan.customerName, WIDTH - 2 * MARGIN) as string[];
  const nameChunks = Array.from({ length: Math.max(1, Math.ceil(fullNameLines.length / 12)) }, (_, index) => fullNameLines.slice(index * 12, (index + 1) * 12));
  const today = dateKey(now);
  const payments = loan.validPayments.filter((payment) => payment.status === 'VALID')
    .sort((a, b) => a.paymentDate.localeCompare(b.paymentDate) || a.id.localeCompare(b.id));
  const pendingEntries = numberCurrentPaymentPlan(loan.plan,
    payments.flatMap((payment) => payment.applications ?? []))
    .filter((entry) => (parseMoneyCents(entry.pendingAmount) ?? 0n) > 0n);

  function header(nameLines: string[], continuation = false, compact = false): number {
    const status = STATUS_LABELS[loan.status] ?? loan.status;
    if (['CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE'].includes(loan.status)) {
      const cancelled = loan.status === 'CANCELLED';
      const refinanced = loan.status === 'REFINANCED';
      const prominent = cancelled || refinanced;
      doc.saveGraphicsState();
      doc.setGState(doc.GState({ opacity: prominent ? 0.2 : 0.14 }));
      if (cancelled) doc.setTextColor(35, 107, 69);
      else if (refinanced) doc.setTextColor(145, 45, 45);
      else doc.setTextColor(90);
      doc.setFont('helvetica', 'bold');
      if (refinanced) {
        doc.setFontSize(REFINANCED_WATERMARK_MAX_FONT_SIZE);
        const angle = WATERMARK_ANGLE * Math.PI / 180;
        const initialDimensions = doc.getTextDimensions(status);
        const rotatedWidth = initialDimensions.w * Math.cos(angle) + initialDimensions.h * Math.sin(angle);
        const rotatedHeight = initialDimensions.w * Math.sin(angle) + initialDimensions.h * Math.cos(angle);
        const scale = Math.min(
          1,
          (WIDTH - 2 * REFINANCED_WATERMARK_MARGIN) / rotatedWidth,
          (HEIGHT - 2 * REFINANCED_WATERMARK_MARGIN) / rotatedHeight,
        );
        doc.setFontSize(Math.floor(REFINANCED_WATERMARK_MAX_FONT_SIZE * scale * 100) / 100);
        const dimensions = doc.getTextDimensions(status);
        const x = WIDTH / 2 - (dimensions.w * Math.cos(angle) - dimensions.h * Math.sin(angle)) / 2;
        const y = HEIGHT / 2 + (dimensions.w * Math.sin(angle) + dimensions.h * Math.cos(angle)) / 2;
        doc.text(status, x, y, { angle: WATERMARK_ANGLE });
      } else {
        doc.setFontSize(cancelled ? 30 : 19);
        doc.text(status, WIDTH / 2, HEIGHT / 2, { align: 'center', angle: WATERMARK_ANGLE });
      }
      doc.restoreGraphicsState();
    }
    doc.setTextColor(0);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(11);
    doc.text('Plan de pago', MARGIN, 9);
    let y = 14;
    for (const line of limitedLines(doc, `Préstamo #${loan.loanNumber}`, 2)) { doc.text(line, MARGIN, y); y += 4.5; }
    if (compact) {
      doc.setFont('helvetica', 'normal');
      doc.setFontSize(7.5);
      for (const line of limitedLines(doc, `Cliente: ${loan.customerName}`, 1)) { doc.text(line, MARGIN, y + 1); y += 4; }
      doc.setLineWidth(0.2);
      doc.line(MARGIN, y + 2, WIDTH - MARGIN, y + 2);
      return y + 5;
    }
    doc.setFontSize(8);
    doc.text(continuation ? 'CLIENTE (continuación)' : 'CLIENTE', MARGIN, y + 1); y += 3.5;
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(9.5);
    for (const line of nameLines) { doc.text(line, MARGIN, y + 1); y += 3.9; }
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7.5);
    for (const text of [`Identificación: ${loan.identification}`, `Estado: ${status}  |  Inicio: ${formatDateOnlyForDisplay(loan.startDate)}`]) {
      for (const line of limitedLines(doc, text, 2)) { doc.text(line, MARGIN, y + 1); y += 4; }
    }
    for (const [label, value] of [
      ['Principal', loan.principal], ['Interés', loan.interestAmount],
      ['Total', loan.totalAmount], ['Saldo actual', loan.financialBalance],
    ]) {
      if (label === 'Saldo actual') { doc.setFont('helvetica', 'bold'); doc.setFontSize(8.5); }
      doc.text(label === 'Saldo actual' ? 'SALDO ACTUAL' : label, MARGIN, y + 1);
      doc.text(getPdfMoneyText(value), WIDTH - MARGIN, y + 1, { align: 'right' });
      if (label === 'Saldo actual') { doc.setFont('helvetica', 'normal'); doc.setFontSize(7.5); }
      y += 4;
    }
    for (const text of [`Frecuencia: ${loan.frequencyName}`, `Forma preferida: ${loan.preferredPaymentMethod}`]) {
      if (!text.split(': ')[1]) continue;
      for (const line of limitedLines(doc, text, 2)) { doc.text(line, MARGIN, y + 1); y += 3.5; }
    }
    if (loan.collectionProjection.operationalDate) {
      doc.setFont('helvetica', 'bold');
      doc.text(loan.collectionProjection.operationalDateKind === 'TODAY' ? 'COBRO PENDIENTE HOY' : 'PRÓXIMO COBRO', MARGIN, y + 1);
      doc.text(getPdfMoneyText(loan.collectionProjection.totalSuggestedAmount), WIDTH - MARGIN, y + 1, { align: 'right' }); y += 4;
      doc.setFont('helvetica', 'normal');
      doc.text(`Atrasado ${getPdfMoneyText(loan.collectionProjection.overdueAmount)}  |  Programado ${getPdfMoneyText(loan.collectionProjection.scheduledAmount)}`, MARGIN, y + 1); y += 4;
      doc.text(`Fecha operativa: ${formatDateOnlyForDisplay(loan.collectionProjection.operationalDate)}`, MARGIN, y + 1); y += 4;
    }
    doc.setLineWidth(0.2);
    doc.line(MARGIN, y + 2, WIDTH - MARGIN, y + 2);
    return y + 5;
  }

  let y = header(nameChunks[0]);
  for (const continuation of nameChunks.slice(1)) { doc.addPage([WIDTH, HEIGHT], 'portrait'); y = header(continuation, true); }

  function addPage(): void {
    doc.addPage([WIDTH, HEIGHT], 'portrait');
    y = header(nameChunks[0], false, true);
  }

  function section(title: string): void {
    if (y + SECTION_HEIGHT + ROW_HEIGHT > CONTENT_BOTTOM) addPage();
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(8);
    doc.text(title, MARGIN, y + 4);
    doc.line(MARGIN, y + 5.5, WIDTH - MARGIN, y + 5.5);
    doc.setFont('helvetica', 'normal');
    y += SECTION_HEIGHT;
  }

  function row(prefix: string, condition: string, amountValue: string): void {
    doc.setFontSize(7.5);
    doc.setFont('helvetica', 'bold');
    const amount = getPdfMoneyText(amountValue);
    const labelWidth = doc.getTextWidth(prefix) + doc.getTextWidth(condition);
    doc.setFont('helvetica', 'normal');
    const amountWidth = doc.getTextWidth(amount);
    const fontSize = Math.max(4.5, Math.floor(7.5 * Math.min(1, (WIDTH - 2 * MARGIN - 2) / (labelWidth + amountWidth)) * 4) / 4);
    doc.setFont('helvetica', 'bold');
    doc.setFontSize(fontSize);
    const prefixWidth = doc.getTextWidth(prefix);
    const stateRight = MARGIN + prefixWidth + doc.getTextWidth(condition);
    doc.setFont('helvetica', 'normal');
    const amountLeft = WIDTH - MARGIN - doc.getTextWidth(amount);
    if (stateRight + 2 > amountLeft) throw new Error('Receipt row exceeds printable width.');
    doc.setFont('helvetica', 'bold');
    doc.text(prefix, MARGIN, y + 4.5);
    if (condition === 'PAGO RECIBIDO') doc.setTextColor(24, 99, 55);
    if (condition === 'PENDIENTE' || condition === 'VENCIDA') doc.setTextColor(220, 38, 38);
    doc.text(condition, MARGIN + prefixWidth, y + 4.5);
    doc.setTextColor(0);
    doc.setFont('helvetica', 'normal');
    doc.text(amount, WIDTH - MARGIN, y + 4.5, { align: 'right' });
    doc.line(MARGIN, y + ROW_HEIGHT - 1.5, WIDTH - MARGIN, y + ROW_HEIGHT - 1.5);
    y += ROW_HEIGHT;
  }

  section('PAGOS RECIBIDOS');
  if (!payments.length) { doc.setFontSize(7.5); doc.text('No hay pagos recibidos.', MARGIN, y + 4); y += ROW_HEIGHT; }
  for (const payment of payments) {
    if (y + ROW_HEIGHT > CONTENT_BOTTOM) { addPage(); section('PAGOS RECIBIDOS (CONTINUACIÓN)'); }
    row(`${formatDateOnlyForDisplay(payment.paymentDate)}  `, 'PAGO RECIBIDO', payment.amount);
  }

  section('CUOTAS PENDIENTES');
  if (!pendingEntries.length) { doc.setFontSize(7.5); doc.text('No hay cuotas pendientes.', MARGIN, y + 4); y += ROW_HEIGHT; }
  for (const entry of pendingEntries) {
    if (y + ROW_HEIGHT > CONTENT_BOTTOM) { addPage(); section('CUOTAS PENDIENTES (CONTINUACIÓN)'); }
    row(`CUOTA ${entry.sequence}  ${formatDateOnlyForDisplay(entry.dueDate)}  `, entry.dueDate < today ? 'VENCIDA' : 'PENDIENTE', entry.pendingAmount);
  }
  if (y + 15 > CONTENT_BOTTOM) addPage();
  const paid = payments.reduce((sum, payment) => sum + (parseMoneyCents(payment.amount) ?? 0n), 0n);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(8);
  doc.text('Total pagado', MARGIN, y + 4);
  doc.text(getPdfMoneyText(moneyFromCents(paid)), WIDTH - MARGIN, y + 4, { align: 'right' });
  doc.text('Saldo actual', MARGIN, y + 9);
  doc.text(getPdfMoneyText(loan.financialBalance), WIDTH - MARGIN, y + 9, { align: 'right' });

  const generated = `${formatDateOnlyForDisplay(today)} ${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const pageCount = doc.getNumberOfPages();
  for (let page = 1; page <= pageCount; page += 1) {
    doc.setPage(page);
    doc.setFont('helvetica', 'normal');
    doc.setFontSize(7);
    doc.line(MARGIN, HEIGHT - 13, WIDTH - MARGIN, HEIGHT - 13);
    doc.text(`Generado: ${generated}`, MARGIN, HEIGHT - 9);
    doc.text(`Página ${page}/${pageCount}`, WIDTH - MARGIN, HEIGHT - 5, { align: 'right' });
  }
  return doc;
}

export async function generateLoanPaymentPlanReport(loan: LoanOperationalDetail): Promise<void> {
  openPdfPreview(await createLoanPaymentPlanDocument(loan));
}
