import { CASH_MOVEMENT_CONCEPT_LABELS, type CashMovement, type CashMovementSummary } from '../../domain/entities/cash-movement';
import { formatCRCForPdf } from '../../shared/utils/money';
import type { WorkBook } from 'xlsx';

type XlsxModule = typeof import('xlsx');
type SheetWithFreeze = ReturnType<XlsxModule['utils']['aoa_to_sheet']> & { '!freeze'?: { xSplit: number; ySplit: number } };

const EXCEL_HEADERS = ['Fecha', 'Tipo', 'Concepto', 'Préstamo', 'Forma de pago', 'Monto', 'Registrado por', 'Observaciones'];
const EXCEL_CURRENCY_FORMAT = '"₡"#,##0.00;[Red]-"₡"#,##0.00';

function excelDate(value: string): Date | string {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  if (date.getUTCFullYear() !== Number(year) || date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) return value;
  return new Date(Number(year), Number(month) - 1, Number(day));
}

function signedNumber(amount: string, direction: CashMovement['direction']): number {
  const value = Math.abs(Number(amount));
  return direction === 'INFLOW' ? value : -value;
}

function summaryNumber(value: string): number {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function signedPdfCRC(amount: string, direction: CashMovement['direction']): string {
  const formatted = formatCRCForPdf(amount.replace(/^-/, ''));
  return formatted === '—' ? formatted : `${direction === 'INFLOW' ? '+' : '-'}${formatted}`;
}

export function buildCashMovementWorkbook(XLSX: XlsxModule, items: CashMovement[], summary: CashMovementSummary, fromDate?: string, toDate?: string): WorkBook {
  const headerRow = 9;
  const rows: unknown[][] = [
    ['Movimientos de caja'],
    ['Período', `${fromDate || 'Inicio'} a ${toDate || 'Hoy'}`],
    ['Total de registros', items.length],
    [],
    ['Resumen'],
    ['Entradas', summaryNumber(summary.inflows)],
    ['Salidas', summaryNumber(summary.outflows)],
    ['Neto', summaryNumber(summary.net)],
    [],
    EXCEL_HEADERS,
    ...items.map((item) => [
      excelDate(item.movementDate),
       item.direction === 'INFLOW' ? 'INGRESO' : 'EGRESO',
      CASH_MOVEMENT_CONCEPT_LABELS[item.concept],
      item.loanNumber ? `Préstamo #${item.loanNumber}` : '',
      item.paymentMethod.name,
      signedNumber(item.amount, item.direction),
      item.createdBy.fullName,
      item.observations || '',
    ]),
  ];
  const worksheet = XLSX.utils.aoa_to_sheet(rows) as SheetWithFreeze;
  const lastRow = Math.max(headerRow + items.length, headerRow);
  worksheet['!autofilter'] = { ref: `A${headerRow + 1}:H${lastRow + 1}` };
  worksheet['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 };
  worksheet['!cols'] = [{ wch: 13 }, { wch: 10 }, { wch: 34 }, { wch: 16 }, { wch: 20 }, { wch: 16 }, { wch: 24 }, { wch: 34 }];
  for (const row of [5, 6, 7, 8]) {
    const cell = worksheet[`B${row + 1}`];
    if (cell && row >= 5) cell.z = EXCEL_CURRENCY_FORMAT;
  }
  for (let index = 0; index < items.length; index += 1) {
    const cell = worksheet[`F${headerRow + 2 + index}`];
    if (cell) cell.z = EXCEL_CURRENCY_FORMAT;
    const dateCell = worksheet[`A${headerRow + 2 + index}`];
    const dateValue = excelDate(items[index].movementDate);
    if (dateCell && dateValue instanceof Date) {
      dateCell.v = dateValue;
      dateCell.t = 'd';
      dateCell.z = 'dd/mm/yyyy';
    }
  }
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Movimientos de caja');
  return workbook;
}

export async function generateCashMovementExcel(items: CashMovement[], summary: CashMovementSummary, fromDate?: string, toDate?: string): Promise<void> {
  const XLSX = await import('xlsx');
  const workbook = buildCashMovementWorkbook(XLSX, items, summary, fromDate, toDate);
  XLSX.writeFile(workbook, `movimientos-caja-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export async function generateCashMovementReport(items: CashMovement[], summary: CashMovementSummary, fromDate?: string, toDate?: string): Promise<void> { const { jsPDF } = await import('jspdf'); const { autoTable } = await import('jspdf-autotable'); const doc = new jsPDF(); const now = new Date(); doc.setFontSize(15); doc.text('Movimientos de caja', 10, 14); doc.setFontSize(9); doc.text(`Período: ${fromDate || 'Inicio'} a ${toDate || 'Hoy'}`, 10, 21); autoTable(doc, { head: [['Fecha', 'Tipo', 'Concepto', 'Forma de pago', 'Monto', 'Registrado por']], body: items.map((item) => [item.movementDate, item.direction === 'INFLOW' ? 'Entrada' : 'Salida', `${CASH_MOVEMENT_CONCEPT_LABELS[item.concept]}${item.loanNumber ? ` · Préstamo #${item.loanNumber}` : ''}`, item.paymentMethod.name, signedPdfCRC(item.amount, item.direction), item.createdBy.fullName]), startY: 28 }); const finalY = (doc as unknown as { lastAutoTable?: { finalY: number } }).lastAutoTable?.finalY ?? 35; doc.text(`Entradas: ${formatCRCForPdf(summary.inflows)}   Salidas: ${formatCRCForPdf(summary.outflows)}   Neto: ${formatCRCForPdf(summary.net)}`, 10, finalY + 10); doc.save(`movimientos-caja-${now.toISOString().slice(0, 10)}.pdf`); }
