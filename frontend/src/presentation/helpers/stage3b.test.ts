import { describe, expect, it, vi } from 'vitest';
import { allowedOperationalDate, dayNavigation, nonNegativeMoney, positiveMoney, retryKeyFor, runLatestRequest, validatePrecollectionCapture } from './stage3b';

describe('Stage 3B interaction safeguards', () => {
  it('keeps an idempotency key for the same payload and replaces it only when data changes', () => {
    vi.stubGlobal('crypto', { randomUUID: vi.fn().mockReturnValueOnce('key-1').mockReturnValueOnce('key-2') });
    const first = retryKeyFor({ amount: '10.00' });
    expect(retryKeyFor({ amount: '10.00' }, first)).toBe(first);
    expect(retryKeyFor({ amount: '11.00' }, first).key).toBe('key-2');
    vi.unstubAllGlobals();
  });

  it('rejects empty, malformed, zero and negative capture amounts', () => {
    expect(positiveMoney('')).toBe('');
    expect(positiveMoney('0')).toBe('');
    expect(positiveMoney('-1')).toBe('');
    expect(positiveMoney('10,25')).toBe('10.25');
  });

  it('accepts zero as a delivered settlement amount but rejects negative values', () => {
    expect(nonNegativeMoney('0')).toBe('0');
    expect(nonNegativeMoney('125,50')).toBe('125.50');
    expect(nonNegativeMoney('-1')).toBe('');
  });

  it('never permits a future operational date or next-day navigation past today', () => {
    expect(allowedOperationalDate('2026-10-13', '2026-10-12')).toBe(false);
    expect(dayNavigation('2026-10-12', '2026-10-12').next).toBeNull();
    expect(dayNavigation('2026-10-11', '2026-10-12').next).toBe('2026-10-12');
  });

  it('navigates across month and year boundaries and exposes Costa Rica today', () => {
    expect(dayNavigation('2026-03-01', '2026-10-12')).toMatchObject({ previous: '2026-02-28', next: '2026-03-02', today: '2026-10-12' });
    expect(dayNavigation('2026-12-31', '2027-01-02')).toMatchObject({ previous: '2026-12-30', next: '2027-01-01', today: '2027-01-02' });
  });

  it('ignores stale successes and settlements during rapid date navigation', async () => {
    let resolveOld!: (value: string) => void;
    let resolveLatest!: (value: string) => void;
    const oldRequest = new Promise<string>((resolve) => { resolveOld = resolve; });
    const latestRequest = new Promise<string>((resolve) => { resolveLatest = resolve; });
    const updates: string[] = [];
    const settled: string[] = [];
    let currentRequest = 1;
    const old = runLatestRequest(() => oldRequest, () => currentRequest === 1, (value) => updates.push(value), vi.fn(), () => settled.push('old'));
    currentRequest = 2;
    const latest = runLatestRequest(() => latestRequest, () => currentRequest === 2, (value) => updates.push(value), vi.fn(), () => settled.push('latest'));

    resolveLatest('2026-10-12');
    await latest;
    resolveOld('2026-10-11');
    await old;

    expect(updates).toEqual(['2026-10-12']);
    expect(settled).toEqual(['latest']);
  });

  it('requires method and explicit custody and blocks a second in-flight capture', () => {
    expect(validatePrecollectionCapture({ amount: '10', effectiveDate: '2026-10-12', paymentMethodId: '', custodyTreatment: '' })
      .map((error) => error.field)).toEqual(['paymentMethodId', 'custodyTreatment']);
    expect(validatePrecollectionCapture({ amount: '10', effectiveDate: '2026-10-12', paymentMethodId: 'cash', custodyTreatment: 'COLLECTOR_HELD' }, true))
      .toMatchObject([{ field: 'submission', codes: ['BUSY'] }]);
  });
});
