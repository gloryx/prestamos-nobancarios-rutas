import { describe, expect, it, vi } from 'vitest';
import type { PaymentContext } from '../../infrastructure/api/payment.api';
import { loadActivePaymentContext, paymentLoanIdFromSearch, paymentSearchWithLoan, selectPaymentLoanFromDialog } from './payment-loan-link';

const a = '14870d77-8723-49e5-96b8-e4313943d726';
const b = '3e832c09-8bbc-41f3-ae22-086874b688f9';
const context = (id: string, status = 'ACTIVE') => ({ summary: { loanId: id, status } }) as unknown as PaymentContext;

describe('payment loan URL selection', () => {
  it('accepts one UUID, rejects empty/duplicate/invalid IDs and preserves unrelated search params', () => {
    expect(paymentLoanIdFromSearch(`?loanId=${a}`)).toEqual({ id: a, error: null });
    expect(paymentLoanIdFromSearch(`?other=1&loanId=${a.toUpperCase()}`)).toEqual({ id: a, error: null });
    expect(paymentLoanIdFromSearch('?other=1')).toEqual({ id: null, error: null });
    for (const search of ['?loanId=', '?loanId=loan-1', `?loanId=${a}&loanId=${b}`, '?loanId=%20']) {
      expect(paymentLoanIdFromSearch(search)).toMatchObject({ id: null, error: expect.any(String) });
    }
    const changed = paymentSearchWithLoan(`?page=2&loanId=${a}`, b);
    expect(changed.toString()).toBe(`page=2&loanId=${b}`);
    expect(paymentLoanIdFromSearch(`?${changed}`).id).toBe(b);
    expect(paymentSearchWithLoan(changed.toString(), null).toString()).toBe('page=2');
    expect(paymentSearchWithLoan(`?loanId=${a}&loanId=${b}&page=2`, null).toString()).toBe('page=2');
  });

  it('loads a canonical lowercase context from an uppercase deep link', async () => {
    const parsed = paymentLoanIdFromSearch(`?loanId=${a.toUpperCase()}`);
    const api = { context: vi.fn().mockResolvedValue(context(a)) };
    expect(await loadActivePaymentContext(parsed.id!, () => true, api)).toEqual(context(a));
    expect(api.context).toHaveBeenCalledExactlyOnceWith(a);
  });

  it('retries a failed same-ID modal selection once without navigation, but navigates for B without a second GET', async () => {
    const api = { context: vi.fn().mockRejectedValueOnce(new Error('Temporary failure')).mockResolvedValueOnce(context(a)) };
    await expect(loadActivePaymentContext(a, () => true, api)).rejects.toThrow('Temporary failure');
    let pendingRetry: Promise<PaymentContext | null> | undefined;
    const retry = vi.fn((id: string) => { pendingRetry = loadActivePaymentContext(id, () => true, api); });
    const navigate = vi.fn();
    selectPaymentLoanFromDialog(a, a, a, retry, navigate);
    expect(retry).toHaveBeenCalledExactlyOnceWith(a);
    expect(navigate).not.toHaveBeenCalled();
    expect(await pendingRetry).toEqual(context(a));
    expect(api.context.mock.calls).toEqual([[a], [a]]);

    selectPaymentLoanFromDialog(a, a, null, retry, navigate);
    expect(retry).toHaveBeenCalledTimes(1);
    selectPaymentLoanFromDialog(b, a, a, retry, navigate);
    expect(navigate).toHaveBeenCalledExactlyOnceWith(b);
    expect(api.context).toHaveBeenCalledTimes(2);
    const next = { context: vi.fn().mockResolvedValue(context(b)) };
    expect(await loadActivePaymentContext(b, () => true, next)).toEqual(context(b));
    expect(next.context).toHaveBeenCalledExactlyOnceWith(b);
  });

  it('loads a fresh context for each direct link and rejects missing, mismatched or inactive loans', async () => {
    const api = { context: vi.fn().mockResolvedValue(context(a)) };
    expect(await loadActivePaymentContext(a, () => true, api)).toEqual(context(a));
    expect(await loadActivePaymentContext(a, () => true, api)).toEqual(context(a));
    expect(api.context.mock.calls).toEqual([[a], [a]]);
    for (const value of [context(a, 'CANCELLED'), context(a, 'UNCOLLECTIBLE'), context(b), { summary: { loanId: a } }]) {
      api.context.mockResolvedValueOnce(value);
      await expect(loadActivePaymentContext(a, () => true, api)).rejects.toThrow('ya no está activo');
    }
    api.context.mockRejectedValueOnce(new Error('Not found'));
    await expect(loadActivePaymentContext(a, () => true, api)).rejects.toThrow('Not found');
    api.context.mockRejectedValueOnce(new Error('Forbidden'));
    await expect(loadActivePaymentContext(a, () => true, api)).rejects.toThrow('Forbidden');
  });

  it('does not publish a stale A response after B becomes the current URL selection', async () => {
    let resolveA!: (result: PaymentContext) => void;
    let resolveB!: (result: PaymentContext) => void;
    const api = { context: vi.fn().mockReturnValueOnce(new Promise<PaymentContext>((resolve) => { resolveA = resolve; }))
      .mockReturnValueOnce(new Promise<PaymentContext>((resolve) => { resolveB = resolve; })) };
    let current = a;
    const pendingA = loadActivePaymentContext(a, () => current === a, api);
    current = b;
    const pendingB = loadActivePaymentContext(b, () => current === b, api);
    resolveB(context(b));
    expect((await pendingB)?.summary.loanId).toBe(b);
    resolveA(context(a));
    expect(await pendingA).toBeNull();
    expect(api.context.mock.calls).toEqual([[a], [b]]);
  });
});
