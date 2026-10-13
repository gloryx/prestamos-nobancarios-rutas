import { attachPaymentApplications, readPaymentApplications } from '../src/application/payment/payment-read-applications';

describe('payment read applications', () => {
  const rows = [
    { paymentId: 'payment-one', planEntryId: 'entry-15', sequence: 15, amountApplied: '20000.00', pendingAfter: '0.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null, sourceDueDate: '2026-10-08', createdAt: new Date('2026-10-12') },
    { paymentId: 'payment-many', planEntryId: 'entry-16', sequence: 16, amountApplied: '10000.00', pendingAfter: '0.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null, sourceDueDate: '2026-10-09', createdAt: new Date('2026-10-13') },
    { paymentId: 'payment-many', planEntryId: 'entry-17', sequence: 17, amountApplied: '10000.00', pendingAfter: '0.00', carriedForwardAmount: '0.00', carriedToPlanEntryId: null, sourceDueDate: '2026-10-10', createdAt: new Date('2026-10-13') },
    { paymentId: 'payment-carry', planEntryId: 'entry-18', sequence: 18, amountApplied: '0.00', pendingAfter: '5000.00', carriedForwardAmount: '5000.00', carriedToPlanEntryId: 'entry-19', sourceDueDate: '2026-10-12', createdAt: new Date('2026-10-14') },
  ];

  it('reads every loan application in one ordered query without inventing missing history', async () => {
    const query = jest.fn(async (..._args: [string, unknown[]]) => rows);
    await expect(readPaymentApplications({ query }, 'loan-4664')).resolves.toEqual(rows);
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain('source.sequence');
    expect(query.mock.calls[0][0]).toContain("p.status = 'VALID'");
    expect(query.mock.calls[0][1]).toEqual(['loan-4664']);
  });

  it('attaches one, multiple, or no verified applications and excludes zero-value carry metadata', () => {
    const result = attachPaymentApplications([
      { id: 'payment-one', amount: '20000.00' }, { id: 'payment-many', amount: '20000.00' },
      { id: 'payment-without-history', amount: '5000.00' }, { id: 'payment-carry', amount: '5000.00' },
    ], rows);
    expect(result).toEqual([
      { id: 'payment-one', amount: '20000.00', applications: [{ planEntryId: 'entry-15', sequence: 15, amountApplied: '20000.00', pendingAfter: '0.00' }] },
      { id: 'payment-many', amount: '20000.00', applications: [
        { planEntryId: 'entry-16', sequence: 16, amountApplied: '10000.00', pendingAfter: '0.00' },
        { planEntryId: 'entry-17', sequence: 17, amountApplied: '10000.00', pendingAfter: '0.00' },
      ] },
      { id: 'payment-without-history', amount: '5000.00', applications: [] },
      { id: 'payment-carry', amount: '5000.00', applications: [] },
    ]);
  });
});
