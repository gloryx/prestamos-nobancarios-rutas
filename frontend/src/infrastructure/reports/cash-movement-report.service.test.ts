import { describe, expect, it, vi } from 'vitest';
import * as XLSX from 'xlsx';
import type { CashMovement, CashMovementSummary } from '../../domain/entities/cash-movement';
import { buildCashMovementWorkbook, generateCashMovementReport } from './cash-movement-report.service';

const pdf = vi.hoisted(() => ({ setFontSize: vi.fn(), text: vi.fn(), save: vi.fn(), autoTable: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class {
  lastAutoTable = { finalY: 55 };
  setFontSize = pdf.setFontSize;
  text = pdf.text;
  save = pdf.save;
} }));
vi.mock('jspdf-autotable', () => ({ autoTable: pdf.autoTable }));

const summary: CashMovementSummary = { inflows: '1500.00', outflows: '250.00', net: '1250.00', currentAvailable: '1250.00', openingDate: '2026-09-01' };
const items: CashMovement[] = [
  { id: 'internal-id-1', direction: 'INFLOW', concept: 'LOAN_DISBURSEMENT', amount: '1000.00', movementDate: '2026-09-02', loanNumber: '42', paymentMethod: { id: 'payment-id', name: 'Efectivo', isActive: true }, observations: 'Entrega', reversedMovementId: null, createdBy: { id: 'user-id', fullName: 'Ana Pérez' }, createdAt: '2026-09-02T12:00:00Z' },
  { id: 'internal-id-2', direction: 'OUTFLOW', concept: 'OPERATING_EXPENSE', amount: '250.00', movementDate: '2026-09-03', paymentMethod: { id: 'payment-id-2', name: 'Transferencia', isActive: true }, observations: null, reversedMovementId: null, createdBy: { id: 'user-id-2', fullName: 'Luis Mora' }, createdAt: '2026-09-03T12:00:00Z' },
];

describe('cash movement Excel workbook', () => {
  it('writes the expected sheet, metadata, labels, signed values, dates, summary, and no technical IDs', () => {
    const workbook = buildCashMovementWorkbook(XLSX, items, summary, '2026-09-01', '2026-09-30');
    expect(workbook.SheetNames).toEqual(['Movimientos de caja']);
    const sheet = workbook.Sheets['Movimientos de caja'];
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, range: 9, raw: true });

    expect(rows[0]).toEqual(['Fecha', 'Tipo', 'Concepto', 'Préstamo', 'Forma de pago', 'Monto', 'Registrado por', 'Observaciones']);
    expect(rows[1].slice(1)).toEqual(['INGRESO', 'Desembolso de préstamo', 'Préstamo #42', 'Efectivo', 1000, 'Ana Pérez', 'Entrega']);
    expect(rows[2].slice(1)).toEqual(['EGRESO', 'Gasto operativo', '', 'Transferencia', -250, 'Luis Mora', '']);
    expect(sheet.A11.v).toEqual(new Date(2026, 8, 2));
    expect(sheet.A11.t).toBe('d');
    expect(sheet.A11.z).toBe('dd/mm/yyyy');
    expect(sheet.F11.z).toContain('₡');
    expect(XLSX.utils.sheet_to_json(sheet, { header: 1, raw: true })).toEqual(expect.arrayContaining([
      ['Entradas', 1500],
      ['Salidas', 250],
      ['Neto', 1250],
    ]));
    expect(JSON.stringify(rows)).not.toContain('internal-id');
    expect(JSON.stringify(rows)).not.toContain('payment-id');
  });

  it('leaves the loan column blank when loanNumber is absent', () => {
    const workbook = buildCashMovementWorkbook(XLSX, [items[1]], summary);
    const sheet = workbook.Sheets['Movimientos de caja'];
    expect(sheet.D11.v).toBe('');
  });
});

describe('cash movement PDF', () => {
  it('sends PDF-safe CRC amounts with ASCII direction signs to the table and summary', async () => {
    const reportItems: CashMovement[] = [
      { ...items[0], amount: '70000.00' },
      { ...items[1], amount: '160000.00' },
      { ...items[0], id: 'internal-id-3', amount: '1320000.00', loanNumber: undefined },
    ];
    const reportSummary: CashMovementSummary = { ...summary, inflows: '1390000.00', outflows: '160000.00', net: '-1230000.00' };

    await generateCashMovementReport(reportItems, reportSummary, '2026-09-01', '2026-09-30');

    expect(pdf.autoTable).toHaveBeenCalledTimes(1);
    const { body, startY } = pdf.autoTable.mock.calls[0][1];
    expect(startY).toBe(28);
    expect(body.map((row: string[]) => row[4])).toEqual(['+¢70.000', '-¢160.000', '+¢1.320.000']);
    expect(body[0][2]).toBe('Desembolso de préstamo · Préstamo #42');
    expect(body[2][2]).toBe('Desembolso de préstamo');
    expect(pdf.text).toHaveBeenCalledWith('Entradas: ¢1.390.000   Salidas: ¢160.000   Neto: -¢1.230.000', 10, 65);
    expect(JSON.stringify([body, pdf.text.mock.calls])).not.toContain('₡');
    expect(pdf.save).toHaveBeenCalledWith(`movimientos-caja-${new Date().toISOString().slice(0, 10)}.pdf`);
  });
});
