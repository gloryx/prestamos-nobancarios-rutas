import { describe, expect, it } from 'vitest';
import * as XLSX from 'xlsx';
import type { ActiveLoanExport } from '../../domain/entities/loan';
import { activeLoansExcelFilename, buildActiveLoansWorkbook } from './active-loans-excel.service';

const data: ActiveLoanExport = {
  items: [{ loanNumber: '42', identification: '101110111', customerName: 'Ana Mora', phone: '88888888', startDate: '2026-01-02',
    principal: '100000.00', interestAmount: '20000.00', totalAmount: '120000.00', outstandingPrincipal: '60000.00',
    outstandingInterest: '15000.00', financialBalance: '75000.00', frequencyName: 'Mensual', dueDate: '2026-06-02', status: 'ACTIVE' }],
  summary: { totalActiveLoans: 1, capitalPlaced: '100000.00', outstandingPrincipal: '60000.00',
    outstandingInterest: '15000.00', financialBalance: '75000.00' },
};

describe('active loans Excel workbook', () => {
  it('creates one analysis-ready sheet with typed amounts, dates, summary, filter and frozen headers', () => {
    const workbook = buildActiveLoansWorkbook(XLSX, data);
    expect(workbook.SheetNames).toEqual(['Préstamos activos']);
    const sheet = workbook.Sheets['Préstamos activos'] as typeof workbook.Sheets[string] & { '!freeze'?: { ySplit: number } };
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: true });
    expect(rows[9]).toEqual(['N.º', 'N.º de préstamo', 'Identificación', 'Cliente', 'Teléfono', 'Fecha del préstamo', 'Capital prestado',
      'Interés', 'Monto total', 'Capital pendiente', 'Interés pendiente', 'Saldo pendiente', 'Periodicidad', 'Fecha límite', 'Estado']);
    expect(rows[10].slice(0, 5)).toEqual([1, '42', '101110111', 'Ana Mora', '88888888']);
    expect(rows[10].slice(6, 13)).toEqual([100000, 20000, 120000, 60000, 15000, 75000, 'Mensual']);
    expect(rows[10][14]).toBe('ACTIVO');
    expect(rows.slice(3, 8)).toEqual([['Total de préstamos activos', 1], ['Capital colocado', 100000], ['Capital pendiente', 60000],
      ['Interés pendiente', 15000], ['Saldo pendiente total', 75000]]);
    expect(sheet['!autofilter']).toEqual({ ref: 'A10:O11' });
    expect(sheet['!freeze']).toEqual({ xSplit: 0, ySplit: 10 });
    for (const address of ['G11', 'H11', 'I11', 'J11', 'K11', 'L11']) {
      expect(sheet[address].t).toBe('n'); expect(sheet[address].z).toContain('₡');
    }
    for (const address of ['F11', 'N11']) {
      expect(sheet[address].t).toBe('d'); expect(sheet[address].z).toBe('dd/mm/yyyy');
    }
    expect(sheet.F11.v).toEqual(new Date(2026, 0, 2));
    expect(sheet.N11.v).toEqual(new Date(2026, 5, 2));
    expect(activeLoansExcelFilename(new Date('2026-10-05T12:00:00Z'))).toBe('prestamos_activos_2026-10-05.xlsx');
    expect(activeLoansExcelFilename(new Date('2026-10-06T03:00:00Z'))).toBe('prestamos_activos_2026-10-05.xlsx');
  });
});
