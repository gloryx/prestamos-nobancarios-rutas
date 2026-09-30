import { evaluateLoanFinancialIntegrity, type ValidPaymentTotals } from '../src/domain/loan/loan-financial-integrity';
import { LoanFinancialTotalsTypeormReader } from '../src/infrastructure/database/typeorm/repositories/loan-financial-totals.reader';

const loan = { principal: '100.00', interestAmount: '20.00', totalAmount: '120.00' };
const empty: ValidPaymentTotals = { paidAmount: '0.00', paidPrincipal: '0.00', paidInterest: '0.00', invalidCount: 0 };
const partial: ValidPaymentTotals = { paidAmount: '25.50', paidPrincipal: '20.00', paidInterest: '5.50', invalidCount: 0 };

describe('canonical loan financial integrity', () => {
  it('returns exact bigint cents for no payments, partial payments and full settlement', () => {
    expect(evaluateLoanFinancialIntegrity(loan, empty, 12000n)).toEqual({ valid: true, validPaidAmount: 0n, validPrincipalApplied: 0n, validInterestApplied: 0n, pendingPlanAmount: 12000n, financialBalance: 12000n, outstandingPrincipal: 10000n, outstandingInterest: 2000n });
    expect(evaluateLoanFinancialIntegrity(loan, partial, 9450n)).toEqual({ valid: true, validPaidAmount: 2550n, validPrincipalApplied: 2000n, validInterestApplied: 550n, pendingPlanAmount: 9450n, financialBalance: 9450n, outstandingPrincipal: 8000n, outstandingInterest: 1450n });
    expect(evaluateLoanFinancialIntegrity(loan, { paidAmount: '120.00', paidPrincipal: '100.00', paidInterest: '20.00', invalidCount: 0 }, 0n)).toMatchObject({ valid: true, financialBalance: 0n, outstandingPrincipal: 0n, outstandingInterest: 0n });
  });

  it.each([
    ['zero principal', { ...loan, principal: '0.00' }, empty, 12000n],
    ['negative interest', { ...loan, interestAmount: '-0.01' }, empty, 12000n],
    ['loan equation', { ...loan, totalAmount: '120.01' }, empty, 12000n],
    ['invalid individual payment', loan, { ...partial, invalidCount: 1 }, 9450n],
    ['negative paid amount', loan, { ...empty, paidAmount: '-0.01' }, 12001n],
    ['negative principal applied', loan, { ...empty, paidPrincipal: '-0.01' }, 12000n],
    ['negative interest applied', loan, { ...empty, paidInterest: '-0.01' }, 12000n],
    ['payment component equation', loan, { ...partial, paidInterest: '5.49' }, 9450n],
    ['principal overapplied', loan, { paidAmount: '101.00', paidPrincipal: '101.00', paidInterest: '0.00', invalidCount: 0 }, 1900n],
    ['interest overapplied', loan, { paidAmount: '21.00', paidPrincipal: '0.00', paidInterest: '21.00', invalidCount: 0 }, 9900n],
    ['financial balance negative', loan, { paidAmount: '120.01', paidPrincipal: '100.00', paidInterest: '20.01', invalidCount: 0 }, 0n],
    ['outstanding components disagree', loan, { ...partial, paidAmount: '25.51' }, 9449n],
    ['negative pending', loan, empty, -1n],
    ['pending does not reconcile', loan, partial, 9449n],
  ] as const)('rejects %s', (_, amounts, totals, pending) => {
    expect(evaluateLoanFinancialIntegrity(amounts, totals, pending).valid).toBe(false);
  });

  it('parses negative fractional cents without treating -0.01 as positive', () => {
    const result = evaluateLoanFinancialIntegrity(loan, { ...empty, paidPrincipal: '-0.01' }, 12000n);
    expect(result).toMatchObject({ valid: false, validPrincipalApplied: -1n, outstandingPrincipal: 10001n });
  });
});

describe('VALID payment totals reader', () => {
  const sql = `SELECT COALESCE(SUM(amount), 0)::text AS "paidAmount", COALESCE(SUM(principal_applied), 0)::text AS "paidPrincipal", COALESCE(SUM(interest_applied), 0)::text AS "paidInterest", COUNT(*) FILTER (WHERE amount <= 0 OR principal_applied < 0 OR interest_applied < 0 OR amount <> principal_applied + interest_applied)::int AS "invalidCount" FROM payments WHERE loan_id = $1 AND status = 'VALID'`;
  const reader = new LoanFinancialTotalsTypeormReader();

  it.each([
    ['zero VALID', empty],
    ['one VALID', partial],
    ['multiple VALID with ANNULLED excluded', { paidAmount: '45.50', paidPrincipal: '40.00', paidInterest: '5.50', invalidCount: 0 }],
  ])('uses the same supplied query context and exact SQL for %s', async (_, row) => {
    const query = jest.fn(async () => [row]);
    await expect(reader.readValidTotals({ query }, 'loan-id')).resolves.toEqual(row);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query).toHaveBeenCalledWith(sql, ['loan-id']);
  });

  it('keeps missing totals distinct and propagates the original SQL failure', async () => {
    const missing = jest.fn(async () => []);
    await expect(reader.readValidTotals({ query: missing }, 'loan-id')).resolves.toBeUndefined();
    expect(missing).toHaveBeenCalledWith(sql, ['loan-id']);
    const failure = new Error('SQL failed');
    await expect(reader.readValidTotals({ query: async () => { throw failure; } }, 'loan-id')).rejects.toBe(failure);
  });
});
