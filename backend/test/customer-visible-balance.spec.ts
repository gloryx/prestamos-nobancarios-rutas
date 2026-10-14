import { calculateCustomerVisibleBalance } from '../src/domain/collector-precollection/customer-visible-balance';

describe('customer-visible precollection balance', () => {
  it.each([
    ['first collection', '100.00', '0.00', '10.00', { before: '100.00', after: '90.00' }],
    ['several pending days', '560000.00', '20000.00', '10000.00', { before: '540000.00', after: '530000.00' }],
    ['partially settled collections', '545000.00', '5000.00', '10000.00', { before: '540000.00', after: '530000.00' }],
    ['same collections converted to firm payments', '540000.00', '0.00', '10000.00', { before: '540000.00', after: '530000.00' }],
    ['cancelled and rejected collections excluded', '100.00', '0.00', '10.00', { before: '100.00', after: '90.00' }],
    ['other-loan collections excluded', '100.00', '0.00', '10.00', { before: '100.00', after: '90.00' }],
  ])('%s', (_scenario, financial, unapplied, received, expected) => {
    expect(calculateCustomerVisibleBalance(financial, unapplied, received)).toEqual(expected);
  });

  it('never exposes a negative customer balance', () => {
    expect(calculateCustomerVisibleBalance('5.00', '10.00', '20.00')).toEqual({ before: '0.00', after: '0.00' });
  });
});
