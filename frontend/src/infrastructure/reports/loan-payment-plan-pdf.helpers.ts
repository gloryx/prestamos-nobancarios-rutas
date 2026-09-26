import type { jsPDF } from 'jspdf';
import { formatCRCForPdf } from '../../shared/utils/money';

export const PDF_MONEY_ROLES = {
  scheduled: [55, 65, 81] as const,
  paid: [38, 120, 72] as const,
  pending: [150, 55, 55] as const,
} as const;

type PdfMoneyRole = keyof typeof PDF_MONEY_ROLES;

export function getPdfMoneyText(value: string): string {
  return formatCRCForPdf(value);
}

export function getPdfMoneyColor(role: PdfMoneyRole): [number, number, number] {
  return [...PDF_MONEY_ROLES[role]] as [number, number, number];
}

export function drawPdfMoneyCell(
  doc: jsPDF,
  cell: { x: number; y: number; width: number; height: number },
  value: string,
  role: PdfMoneyRole,
): void {
  const text = getPdfMoneyText(value);
  const right = cell.x + cell.width - 2;
  doc.setTextColor(...getPdfMoneyColor(role));
  doc.text(text, right, cell.y + cell.height / 2 + 1, { align: 'right' });
}
