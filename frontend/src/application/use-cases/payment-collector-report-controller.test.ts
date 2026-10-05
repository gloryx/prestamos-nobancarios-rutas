import { describe, expect, it, vi } from 'vitest';
import type { PaymentCollectorReportResult } from '../../domain/entities/payment-collector-report';
import { PaymentCollectorReportController } from './payment-collector-report-controller';

const result: PaymentCollectorReportResult = { filters: { fromDate: '2026-10-01', toDate: '2026-10-05' },
  summary: { paymentsCount: 0, totalReceived: '0.00', principalApplied: '0.00', interestApplied: '0.00' },
  collectors: [], options: { collectors: [], paymentMethods: [] } };

describe('payment collector report controller', () => {
  it('loads the Costa Rica current month and preserves backend zero results', async () => {
    const port = { load: vi.fn().mockResolvedValue(result) };
    const controller = new PaymentCollectorReportController(port, () => '2026-10-05');
    await controller.load();
    expect(port.load).toHaveBeenCalledWith({ fromDate: '2026-10-01', toDate: '2026-10-05', collectorId: '', paymentMethodId: '' }, expect.any(AbortSignal));
    expect(controller.getSnapshot()).toMatchObject({ loading: false, data: { collectors: [], summary: { totalReceived: '0.00' } } });
  });

  it('rejects reversed dates without calling the API and clears to current-month defaults', async () => {
    const port = { load: vi.fn().mockResolvedValue(result) };
    const controller = new PaymentCollectorReportController(port, () => '2026-10-05');
    controller.setFilter('fromDate', '2026-10-06');
    await controller.load();
    expect(port.load).not.toHaveBeenCalled();
    expect(controller.getSnapshot().error).toContain('rango de fechas válido');
    controller.clear();
    await Promise.resolve();
    expect(controller.getSnapshot().filters).toEqual({ fromDate: '2026-10-01', toDate: '2026-10-05', collectorId: '', paymentMethodId: '' });
  });
});
