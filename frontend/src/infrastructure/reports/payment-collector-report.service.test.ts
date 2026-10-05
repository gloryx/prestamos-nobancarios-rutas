import { describe, expect, it, vi } from 'vitest';
import type { PaymentCollectorReportResult } from '../../domain/entities/payment-collector-report';
import { generatePaymentCollectorReport } from './payment-collector-report.service';

const pdf = vi.hoisted(() => ({ text: vi.fn(), save: vi.fn(), autoTable: vi.fn() }));
vi.mock('jspdf', () => ({ jsPDF: class { internal = { pageSize: { getWidth: () => 297 } }; setFontSize() {}
  text = pdf.text; save = pdf.save; splitTextToSize(value: string) { return [value]; } } }));
vi.mock('jspdf-autotable', () => ({ autoTable: pdf.autoTable }));

describe('payment collector report PDF', () => {
  it('exports visible aggregates and filter names without technical identifiers', async () => {
    const data: PaymentCollectorReportResult = { filters: { fromDate: '2026-10-01', toDate: '2026-10-31' },
      summary: { paymentsCount: 2, totalReceived: '100.00', principalApplied: '80.00', interestApplied: '20.00' },
      collectors: [{ collectorId: 'hidden-id', collectorName: 'Ana Mora', collectorActive: false, paymentsCount: 2,
        customersCount: 1, loansCount: 1, totalReceived: '100.00', principalApplied: '80.00', interestApplied: '20.00',
        averagePayment: '50.00', participationPercentage: '100.00' }], options: { collectors: [{ id: 'collector-1', name: 'Ana Mora', active: false }],
        paymentMethods: [{ id: 'method-1', name: 'Efectivo', active: true }] } };
    await generatePaymentCollectorReport(data, { fromDate: '2026-10-01', toDate: '2026-10-31', collectorId: 'collector-1', paymentMethodId: 'method-1' }, '2026-10-31');
    expect(pdf.text).toHaveBeenCalledWith('Cobros por cobrador', 10, 14);
    expect(pdf.text.mock.calls[1][0][0]).toContain('Cobrador: Ana Mora');
    expect(pdf.autoTable.mock.calls[0][1].body[0]).toEqual(['Ana Mora', 2, 1, 1, '¢100,00', '¢80,00', '¢20,00', '¢50,00', '100.00%']);
    expect(JSON.stringify(pdf.autoTable.mock.calls[0][1].body)).not.toContain('hidden-id');
    expect(pdf.save).toHaveBeenCalledWith('cobros-por-cobrador-2026-10-31.pdf');
  });
});
