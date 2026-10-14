import type { jsPDF } from 'jspdf';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import { formatDateOnlyForDisplay } from '../../shared/utils/date';
import { formatCRC, formatCRCForPdf } from '../../shared/utils/money';

const WIDTH = 80;
const HEIGHT = 170;
const MARGIN = 5;
const CONTENT_WIDTH = WIDTH - MARGIN * 2;

export type PrecollectionReceiptDocument = { blob: Blob; filename: string };
export type ReceiptShareResult = 'NATIVE_SHARE_COMPLETED' | 'DOWNLOADED_AND_WHATSAPP_OPENED' | 'DOWNLOADED_ONLY';
export type PrecollectionPhoneOption = { kind: 'PRIMARY' | 'SECONDARY'; label: string; display: string; phone: string };

export function canIssuePrecollectionReceipt(item: CollectorPrecollectionDetail): boolean {
  return item.status !== 'CANCELLED' && item.status !== 'REJECTED';
}

function assertReceiptCanBeIssued(item: CollectorPrecollectionDetail): void {
  if (!canIssuePrecollectionReceipt(item)) throw new Error('A receipt cannot be issued for an invalid collection.');
}

export function precollectionReceiptRows(item: CollectorPrecollectionDetail): Array<[string, string]> {
  assertReceiptCanBeIssued(item);
  return [
    ['Comprobante', item.receiptNumber],
    ['Cliente', item.customerName],
    ['Préstamo', item.loanNumber],
    ['Fecha del cobro', formatDateOnlyForDisplay(item.effectiveDate)],
    ['Monto recibido', formatCRCForPdf(item.amount)],
    ['Forma de pago', item.paymentMethodName],
    ...(item.reference ? [['Referencia', item.reference] as [string, string]] : []),
    ['Cobrador', item.collectorName],
    ['Saldo anterior', formatCRCForPdf(item.customerBalanceBefore)],
    ['Cobro recibido', formatCRCForPdf(item.amount)],
    ['Saldo actual', formatCRCForPdf(item.customerBalanceAfter)],
  ];
}

function limitedLines(doc: jsPDF, value: string, width: number, maximum: number): string[] {
  const lines = doc.splitTextToSize(value, width) as string[];
  if (lines.length <= maximum) return lines;
  const visible = lines.slice(0, maximum);
  let last = visible[maximum - 1];
  while (last && doc.getTextWidth(`${last}...`) > width) last = last.slice(0, -1);
  visible[maximum - 1] = `${last}...`;
  return visible;
}

function fitFontSize(doc: jsPDF, text: string, preferred: number, minimum: number, width: number): number {
  doc.setFontSize(preferred);
  if (doc.getTextWidth(text) <= width) return preferred;
  return Math.max(minimum, Math.floor(preferred * width / doc.getTextWidth(text) * 4) / 4);
}

export async function createPrecollectionReceiptDocument(
  item: CollectorPrecollectionDetail,
  issuedAt = new Date(),
): Promise<jsPDF> {
  assertReceiptCanBeIssued(item);
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: [WIDTH, HEIGHT], orientation: 'portrait' });
  doc.setCharSpace(0);

  doc.setFillColor(26, 58, 94);
  doc.rect(0, 0, WIDTH, 20, 'F');
  doc.setTextColor(255, 255, 255);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(12);
  doc.text('Comprobante de cobro', MARGIN, 8);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.setFontSize(fitFontSize(doc, `N.º ${item.receiptNumber}`, 7.5, 5.5, CONTENT_WIDTH / 1.5));
  doc.text(`N.º ${item.receiptNumber}`, MARGIN, 14);
  doc.text(formatDateOnlyForDisplay(item.effectiveDate), WIDTH - MARGIN, 14, { align: 'right' });

  let y = 27;
  doc.setTextColor(90, 101, 116);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(6.5);
  doc.text('CLIENTE', MARGIN, y);
  doc.setTextColor(22, 45, 72);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(9.5);
  const customerLines = limitedLines(doc, item.customerName, CONTENT_WIDTH, 2);
  y += 4.5;
  doc.text(customerLines, MARGIN, y);
  y += customerLines.length * 4.2;
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7.5);
  doc.text(`Préstamo #${item.loanNumber}`, MARGIN, y);

  y += 5;
  doc.setFillColor(239, 246, 253);
  doc.roundedRect(MARGIN, y, CONTENT_WIDTH, 17, 1.5, 1.5, 'F');
  doc.setTextColor(68, 85, 105);
  doc.setFont('helvetica', 'normal');
  doc.setFontSize(7);
  doc.text('MONTO RECIBIDO', WIDTH / 2, y + 5, { align: 'center' });
  const received = formatCRCForPdf(item.amount);
  doc.setTextColor(19, 65, 110);
  doc.setFont('helvetica', 'bold');
  doc.setFontSize(fitFontSize(doc, received, 15, 8, CONTENT_WIDTH - 8));
  doc.text(received, WIDTH / 2, y + 13, { align: 'center' });
  y += 23;

  const detail = (label: string, value: string, maximum = 2) => {
    doc.setTextColor(90, 101, 116); doc.setFont('helvetica', 'normal'); doc.setFontSize(6.3); doc.text(label.toUpperCase(), MARGIN, y);
    doc.setTextColor(22, 45, 72); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
    const lines = limitedLines(doc, value, CONTENT_WIDTH, maximum);
    doc.text(lines, MARGIN, y + 3.8); y += 4.2 + lines.length * 3.6;
  };
  detail('Forma de pago', item.paymentMethodName);
  if (item.reference) detail('Referencia', item.reference, 1);
  detail('Cobrador', item.collectorName);

  y += 2;
  doc.setDrawColor(205, 213, 222); doc.line(MARGIN, y, WIDTH - MARGIN, y); y += 5;
  doc.setTextColor(22, 45, 72); doc.setFont('helvetica', 'bold'); doc.setFontSize(8);
  doc.text('Resumen del préstamo', MARGIN, y); y += 5;
  const moneyRow = (label: string, value: string, emphasized = false) => {
    const amount = formatCRCForPdf(value);
    doc.setTextColor(68, 85, 105); doc.setFont('helvetica', emphasized ? 'bold' : 'normal'); doc.setFontSize(7.5);
    doc.text(label, MARGIN, y);
    doc.setTextColor(22, 45, 72); doc.setFont('helvetica', 'bold');
    doc.setFontSize(fitFontSize(doc, amount, emphasized ? 8.5 : 7.5, 6, CONTENT_WIDTH / 2));
    doc.text(amount, WIDTH - MARGIN, y, { align: 'right' }); y += 5;
  };
  moneyRow('Saldo anterior', item.customerBalanceBefore);
  moneyRow('Cobro recibido', item.amount);
  moneyRow('Saldo actual', item.customerBalanceAfter, true);

  y += 1;
  doc.setDrawColor(205, 213, 222); doc.line(MARGIN, y, WIDTH - MARGIN, y); y += 5;
  doc.setTextColor(68, 85, 105); doc.setFont('helvetica', 'normal'); doc.setFontSize(7);
  if (y > HEIGHT - 5) throw new Error('Precollection receipt exceeds printable height.');
  doc.setFontSize(6.2);
  doc.text(`Emitido ${issuedAt.toLocaleString('es-CR')}`, MARGIN, y);
  return doc;
}

export async function createPrecollectionReceiptPdf(
  item: CollectorPrecollectionDetail,
  issuedAt = new Date(),
): Promise<PrecollectionReceiptDocument> {
  const doc = await createPrecollectionReceiptDocument(item, issuedAt);
  const number = item.receiptNumber.toLowerCase();
  return { blob: doc.output('blob'), filename: `comprobante-${number}.pdf` };
}

export function downloadPrecollectionReceipt(document: PrecollectionReceiptDocument): void {
  const url = URL.createObjectURL(document.blob);
  const link = globalThis.document.createElement('a');
  link.href = url;
  link.download = document.filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function whatsappPhone(phone: string): string | null {
  const trimmed = phone.trim();
  const digits = trimmed.replace(/\D/g, '').replace(/^00/, '');
  if (digits.length === 8) return `506${digits}`;
  return /^\d{9,15}$/.test(digits) ? digits : null;
}

export function precollectionPhoneOptions(item: CollectorPrecollectionDetail): PrecollectionPhoneOption[] {
  const values: Array<{ kind: 'PRIMARY' | 'SECONDARY'; label: string; value: string | null }> = [
    { kind: 'PRIMARY', label: 'Teléfono principal', value: item.customerPhone },
    { kind: 'SECONDARY', label: 'Teléfono secundario', value: item.customerSecondaryPhone },
  ];
  const seen = new Set<string>();
  return values.flatMap(({ kind, label, value }) => {
    const phone = value ? whatsappPhone(value) : null;
    if (!phone || seen.has(phone)) return [];
    seen.add(phone);
    return [{ kind, label, display: value!, phone }];
  });
}

export function precollectionWhatsAppUrl(item: CollectorPrecollectionDetail, recipientPhone = item.customerPhone): string | null {
  if (!canIssuePrecollectionReceipt(item)) return null;
  const phone = whatsappPhone(recipientPhone);
  if (!phone) return null;
  const message = `Hola ${item.customerName}. Comprobante ${item.receiptNumber} del préstamo ${item.loanNumber}: monto ${formatCRC(item.amount)} recibido por ${item.collectorName} el ${formatDateOnlyForDisplay(item.effectiveDate)}. Saldo actual ${formatCRC(item.customerBalanceAfter)}. El PDF debe adjuntarse manualmente si no aparece en WhatsApp.`;
  return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
}

type ShareEnvironment = {
  navigator: { share?: (data: ShareData) => Promise<void>; canShare?: (data: ShareData) => boolean };
  createFile: (blob: Blob, filename: string) => File;
  download: (document: PrecollectionReceiptDocument) => void;
  openWhatsApp: (url: string) => void;
};

const browserShareEnvironment = (): ShareEnvironment => ({
  navigator: globalThis.navigator,
  createFile: (blob, filename) => new File([blob], filename, { type: 'application/pdf' }),
  download: downloadPrecollectionReceipt,
  openWhatsApp: (url) => globalThis.location.assign(url),
});

export async function sharePrecollectionReceiptDocument(
  document: PrecollectionReceiptDocument,
  item: CollectorPrecollectionDetail,
  recipientPhone: string | undefined,
  environment: ShareEnvironment = browserShareEnvironment(),
): Promise<ReceiptShareResult> {
  assertReceiptCanBeIssued(item);
  if (environment.navigator.share && environment.navigator.canShare) {
    const file = environment.createFile(document.blob, document.filename);
    const shareData: ShareData = { title: `Comprobante ${item.receiptNumber}`,
      text: `Comprobante de cobro para ${item.customerName}, préstamo ${item.loanNumber}.`, files: [file] };
    if (!environment.navigator.canShare(shareData)) return fallbackShare(document, item, recipientPhone, environment);
    await environment.navigator.share(shareData);
    return 'NATIVE_SHARE_COMPLETED';
  }
  return fallbackShare(document, item, recipientPhone, environment);
}

function fallbackShare(document: PrecollectionReceiptDocument, item: CollectorPrecollectionDetail,
  recipientPhone: string | undefined, environment: ShareEnvironment): ReceiptShareResult {
  environment.download(document);
  const whatsappUrl = precollectionWhatsAppUrl(item, recipientPhone);
  if (!whatsappUrl) return 'DOWNLOADED_ONLY';
  environment.openWhatsApp(whatsappUrl);
  return 'DOWNLOADED_AND_WHATSAPP_OPENED';
}
