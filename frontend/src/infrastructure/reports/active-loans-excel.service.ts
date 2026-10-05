import type { WorkBook } from 'xlsx';
import type { ActiveLoanExport } from '../../domain/entities/loan';
import { costaRicaDateOnly } from '../../shared/utils/date';

type XlsxModule = typeof import('xlsx');
type StyledSheet = ReturnType<XlsxModule['utils']['aoa_to_sheet']> & { '!freeze'?: { xSplit: number; ySplit: number } };

const HEADERS = ['N.º', 'N.º de préstamo', 'Identificación', 'Cliente', 'Teléfono', 'Fecha del préstamo', 'Capital prestado',
  'Interés', 'Monto total', 'Capital pendiente', 'Interés pendiente', 'Saldo pendiente', 'Periodicidad', 'Fecha límite', 'Estado'];
const CURRENCY_FORMAT = '"₡"#,##0.00;[Red]-"₡"#,##0.00';
const DATE_FORMAT = 'dd/mm/yyyy';

function excelDate(value: string): Date | string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  const date = new Date(Number(year), Number(month) - 1, Number(day));
  return date.getFullYear() === Number(year) && date.getMonth() === Number(month) - 1 && date.getDate() === Number(day) ? date : value;
}

const numeric = (value: string): number => {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new Error('El reporte contiene un monto no válido.');
  return parsed;
};

export function buildActiveLoansWorkbook(XLSX: XlsxModule, exportData: ActiveLoanExport): WorkBook {
  const headerRow = 9;
  const rows: unknown[][] = [
    ['Préstamos activos'],
    [],
    ['Resumen'],
    ['Total de préstamos activos', exportData.summary.totalActiveLoans],
    ['Capital colocado', numeric(exportData.summary.capitalPlaced)],
    ['Capital pendiente', numeric(exportData.summary.outstandingPrincipal)],
    ['Interés pendiente', numeric(exportData.summary.outstandingInterest)],
    ['Saldo pendiente total', numeric(exportData.summary.financialBalance)],
    [],
    HEADERS,
    ...exportData.items.map((loan, index) => [index + 1, loan.loanNumber, loan.identification, loan.customerName, loan.phone,
      excelDate(loan.startDate), numeric(loan.principal), numeric(loan.interestAmount), numeric(loan.totalAmount),
      numeric(loan.outstandingPrincipal), numeric(loan.outstandingInterest), numeric(loan.financialBalance),
      loan.frequencyName, excelDate(loan.dueDate), 'ACTIVO']),
  ];
  const sheet = XLSX.utils.aoa_to_sheet(rows) as StyledSheet;
  const lastRow = Math.max(headerRow + exportData.items.length + 1, headerRow + 1);
  sheet['!autofilter'] = { ref: `A${headerRow + 1}:O${lastRow}` };
  sheet['!freeze'] = { xSplit: 0, ySplit: headerRow + 1 };
  sheet['!cols'] = [{ wch: 7 }, { wch: 17 }, { wch: 18 }, { wch: 30 }, { wch: 16 }, { wch: 18 }, { wch: 18 },
    { wch: 15 }, { wch: 17 }, { wch: 19 }, { wch: 19 }, { wch: 18 }, { wch: 18 }, { wch: 15 }, { wch: 12 }];
  for (let row = 5; row <= 8; row += 1) if (sheet[`B${row}`]) sheet[`B${row}`].z = CURRENCY_FORMAT;
  for (let index = 0; index < exportData.items.length; index += 1) {
    const row = headerRow + 2 + index;
    for (const column of ['G', 'H', 'I', 'J', 'K', 'L']) if (sheet[`${column}${row}`]) sheet[`${column}${row}`].z = CURRENCY_FORMAT;
    for (const [column, value] of [['F', excelDate(exportData.items[index].startDate)], ['N', excelDate(exportData.items[index].dueDate)]] as const) {
      const cell = sheet[`${column}${row}`];
      if (cell && value instanceof Date) { cell.v = value; cell.t = 'd'; cell.z = DATE_FORMAT; }
    }
  }
  for (const column of 'ABCDEFGHIJKLMNO') if (sheet[`${column}${headerRow + 1}`]) sheet[`${column}${headerRow + 1}`].s = { font: { bold: true }, fill: { fgColor: { rgb: 'DDEBF7' } } };
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, 'Préstamos activos');
  return workbook;
}

export const activeLoansExcelFilename = (date = new Date()): string => `prestamos_activos_${costaRicaDateOnly(date)}.xlsx`;

export async function generateActiveLoansExcel(exportData: ActiveLoanExport): Promise<void> {
  const XLSX = await import('xlsx');
  XLSX.writeFile(buildActiveLoansWorkbook(XLSX, exportData), activeLoansExcelFilename(), { cellStyles: true });
}
