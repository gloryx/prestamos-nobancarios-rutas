import { describe, expect, it, vi } from 'vitest';
import { paymentApi, type PaymentContext } from './payment.api';
import { paymentCapturePayload } from '../../presentation/pages/PaymentsPage';

describe('payment loan selector API', () => {
  it('requests the filtered page and preserves the global total', async () => {
    const result = { items: [], total: 37, page: 2, pageSize: 5 };
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => result } as Response);
    try {
      expect(await paymentApi.listLoans('Ana 101', 2, 5)).toEqual(result);
      expect(fetchMock.mock.calls[0][0]).toContain('/payments/loans?search=Ana%20101&page=2&pageSize=5');
      expect(fetchMock.mock.calls[0][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
      await paymentApi.listLoans('Ana 101', 2, 5);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1][1]).toMatchObject({ credentials: 'include', cache: 'no-store' });
    } finally { fetchMock.mockRestore(); }
  });
});

describe('payment capture transport', () => {
  it('POSTs only the current payment contract with an edited canonical amount and required collector', async () => {
    const context = {
      summary: { loanId: 'loan-1' }, balances: { financialBalance: '100.00' },
      firstOperationalRow: { id: 'row-1', sequence: 1, dueDate: '2020-01-01', pendingAmount: '50.00' },
      preferredMethod: { id: 'cash', activeMethods: [{ id: 'cash', name: 'Efectivo' }, { id: 'card', name: 'Tarjeta' }], collectors: [{ id: 'collector-1', name: 'María' }] },
    } as PaymentContext;
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 201, json: async () => ({ id: 'payment-1' }) } as Response);
    try {
      const withCollector = paymentCapturePayload(context, { amount: '₡75,5', paymentDate: '2026-09-28', methodId: 'card', collectorId: 'collector-1' }, '2026-09-28');
      expect(withCollector).not.toBeNull();
      await paymentApi.create({ ...withCollector!, idempotencyKey: 'capture-key' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/payments');
      expect(url).not.toContain('/annul');
      expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(JSON.parse(options!.body as string)).toEqual({ loanId: 'loan-1', paymentDate: '2026-09-28', amount: '75.50', methodId: 'card', collectorId: 'collector-1', idempotencyKey: 'capture-key' });

      expect(paymentCapturePayload(context, { amount: '₡12,5', paymentDate: '2020-01-01', methodId: 'cash', collectorId: '' }, '2026-09-28')).toBeNull();
      expect(fetchMock).toHaveBeenCalledTimes(1);
    } finally { fetchMock.mockRestore(); }
  });
});

describe('payment annulment transport', () => {
  it('POSTs the selected payment path with annulment type, trimmed reason and idempotency key', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 201, json: async () => ({ status: 'ANNULLED' }) } as Response);
    try {
      await paymentApi.annul('payment-1', { reason: '  Corrección  '.trim(), annulmentType: 'DATA_CORRECTION', idempotencyKey: 'retry-key' });
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/payments/payment-1/annul');
      expect(options).toMatchObject({ method: 'POST', credentials: 'include' });
      expect(JSON.parse(options!.body as string)).toEqual({ reason: 'Corrección', annulmentType: 'DATA_CORRECTION', idempotencyKey: 'retry-key' });
    } finally { fetchMock.mockRestore(); }
  });

  it('exposes a controlled 409 response instead of swallowing it', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: false, status: 409, json: async () => ({ message: 'Solo se puede anular el último pago válido.' }) } as Response);
    try { await expect(paymentApi.annul('old', { reason: 'Corrección', annulmentType: 'CASH_REFUND', idempotencyKey: 'key' })).rejects.toThrow('Solo se puede anular el último pago válido.'); }
    finally { fetchMock.mockRestore(); }
  });
});

describe('payment plan customization transport', () => {
  it('PUTs an existing obligation ID and an explicit null for a new obligation', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue({ ok: true, status: 200, json: async () => [] } as Response);
    try {
      const entries = [{ id: 'existing-id', dueDate: '2026-10-01', pendingAmount: '40.00' }, { id: null, dueDate: '2026-11-01', pendingAmount: '60.00' }];
      const base = { financialBalance: '100.00', entries: [{ id: 'existing-id', dueDate: '2026-09-30', pendingAmount: '100.00' }] };
      await paymentApi.customizePlan('loan-1', base, entries, 'plan-key');
      const [url, options] = fetchMock.mock.calls[0];
      expect(url).toContain('/payments/loans/loan-1/plan');
      expect(options).toMatchObject({ method: 'PUT', credentials: 'include' });
      expect(JSON.parse(options!.body as string)).toEqual({ base, entries, idempotencyKey: 'plan-key' });
    } finally { fetchMock.mockRestore(); }
  });
});
