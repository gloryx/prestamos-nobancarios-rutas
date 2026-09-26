import { describe, expect, it } from 'vitest';
import { addInterval, automaticPlan, calculateInformationalRate30Days } from './loan-schedule';
describe('loan schedule', () => {
  it('preserves the monthly anchor at month end', () => expect(addInterval('2026-01-31', 'MONTH', 1)).toBe('2026-02-28'));
  it('adds weekly intervals in seven-day increments', () => expect(addInterval('2026-01-01', 'WEEK', 2)).toBe('2026-01-15'));
  it('puts the exact cents remainder in the last entry without Number arithmetic', () => expect(automaticPlan('2026-01-01', 'DAY', 1, 3, '10.00')).toEqual([{ sequence: 1, dueDate: '2026-01-02', pendingAmount: '3.33' }, { sequence: 2, dueDate: '2026-01-03', pendingAmount: '3.33' }, { sequence: 3, dueDate: '2026-01-04', pendingAmount: '3.34' }]));
  it('supports fifteen-day intervals and preserves the next month anchor', () => { expect(addInterval('2026-01-01', 'DAY/15', 1)).toBe('2026-01-16'); expect(addInterval('2026-01-31', 'MONTH', 2)).toBe('2026-03-31'); });
  it.each([
    ['2026-01-31', '20%'],
    ['2026-02-15', '13,33%'],
    ['2026-03-02', '10%'],
  ])('normalizes the rate over the calendar duration ending %s', (dueDate, expected) => {
    expect(calculateInformationalRate30Days('100.00', '20.00', '2026-01-01', [{ sequence: 1, dueDate, pendingAmount: '120.00' }])).toBe(expected);
  });
  it('returns zero for zero interest', () => expect(calculateInformationalRate30Days('100.00', '0.00', '2026-01-01', [{ sequence: 1, dueDate: '2026-01-31', pendingAmount: '100.00' }])).toBe('0%'));
  it.each([
    ['0.00', '20.00', '2026-01-01', [{ sequence: 1, dueDate: '2026-01-31', pendingAmount: '20.00' }]],
    ['100.00', '20.00', '2026-01-01', []],
    ['100.00', '20.00', 'not-a-date', [{ sequence: 1, dueDate: '2026-01-31', pendingAmount: '120.00' }]],
    ['100.00', '20.00', '2026-01-01', [{ sequence: 1, dueDate: '2026-01-01', pendingAmount: '120.00' }]],
  ])('returns null for invalid inputs or non-positive duration', (principal, interest, start, plan) => {
    expect(calculateInformationalRate30Days(principal, interest, start, plan)).toBeNull();
  });
  it('uses the latest personalized due date', () => {
    const plan = [{ sequence: 1, dueDate: '2026-01-16', pendingAmount: '60.00' }, { sequence: 2, dueDate: '2026-01-31', pendingAmount: '60.00' }];
    expect(calculateInformationalRate30Days('100.00', '20.00', '2026-01-01', plan)).toBe('20%');
    plan[1].dueDate = '2026-02-15';
    expect(calculateInformationalRate30Days('100.00', '20.00', '2026-01-01', plan)).toBe('13,33%');
  });
  it('calculates date-only durations without local timezone shifts', () => expect(calculateInformationalRate30Days('100.00', '20.00', '2026-02-28', [{ sequence: 1, dueDate: '2026-03-30', pendingAmount: '120.00' }])).toBe('20%'));
});
