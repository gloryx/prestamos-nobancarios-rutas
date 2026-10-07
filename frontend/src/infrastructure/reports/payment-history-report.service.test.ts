import { describe, expect, it, vi } from 'vitest';
import type { PaymentHistoryFilters, PaymentHistoryItem } from '../../domain/entities/payment-history';
import { generatePaymentHistoryReport } from './payment-history-report.service';

const pdf = vi.hoisted(() => ({ text: vi.fn(), save: vi.fn(), autoTable: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 297 } };
  setFontSize() {} text = pdf.text; save = pdf.save;
  splitTextToSize(value: string) { return [value]; }
} }));
vi.mock('jspdf-autotable', () => ({ autoTable: pdf.autoTable }));

describe('payment history PDF', () => {
  it('prints full filtered historical rows, dates and PDF-safe CRC without technical IDs', async () => {
    const filters: PaymentHistoryFilters = { startDate: '2026-10-01', endDate: '2026-10-02', search: 'Ana',
      loanNumber: '4548', status: '', paymentMethodId: 'method-1', collectorId: 'collector-1' };
    const item: PaymentHistoryItem = { paymentId: 'hidden-uuid', paymentDate: '2026-10-02', amount: '50000.00',
      principalApplied: '42000.00', interestApplied: '8000.00', status: 'ANNULLED', installments: [1, 2],
      loan: { id: 'hidden-loan', loanNumber: '4548' }, customer: { id: 'hidden-customer', fullName: 'Ana Pérez',
        identification: '123', primaryPhone: '8888' }, paymentMethod: { id: 'method-1', name: 'Transferencia' }, collector: null };
    await generatePaymentHistoryReport([item], filters, { paymentMethods: [{ id: 'method-1', name: 'Transferencia', active: false }],
      collectors: [{ id: 'collector-1', name: 'Bea Solís', active: false }] }, '2026-10-02');
    expect(pdf.text).toHaveBeenCalledWith('Historial de pagos', 10, 14);
    expect(pdf.text.mock.calls[1][0][0]).toContain('Desde: 01/10/2026   Hasta: 02/10/2026');
    expect(pdf.text.mock.calls[1][0][0]).toContain('Cobrador: Bea Solís');
    const { head, body } = pdf.autoTable.mock.calls[0][1];
    expect(head[0]).toEqual(['Fecha', 'Cliente', 'Préstamo', 'Cuota', 'Monto', 'Capital', 'Interés', 'Estado', 'Forma', 'Cobrador']);
    expect(body[0]).toEqual(['02/10/2026', 'Ana Pérez', '#4548', '1, 2', '¢50.000', '¢42.000',
      '¢8.000', 'ANULADO', 'Transferencia', '—']);
    expect(JSON.stringify(body)).not.toContain('hidden-uuid');
    expect(pdf.save).toHaveBeenCalledWith('historial-pagos-2026-10-02.pdf');
  });
});
