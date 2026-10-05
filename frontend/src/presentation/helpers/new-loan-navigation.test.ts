import { describe, expect, it } from 'vitest';
import { initialLoanCustomer, newLoanNavigationState } from './new-loan-navigation';

describe('new loan navigation', () => {
  it('preserves the selected customer data required by the existing loan form', () => {
    const state = newLoanNavigationState({
      id: 'customer-1', identification: '101110111', fullName: 'Ana Mora', primaryPhone: '88887777',
      address: 'San José', isActive: true,
    });

    expect(initialLoanCustomer(state)).toEqual({
      id: 'customer-1', identification: '101110111', fullName: 'Ana Mora', primaryPhone: '88887777', address: 'San José',
    });
  });

  it('keeps normal menu navigation without a preselected customer', () => {
    expect(initialLoanCustomer(null)).toBeUndefined();
    expect(initialLoanCustomer({ customer: { fullName: 'Missing id' } })).toBeUndefined();
  });
});
