import type { CustomerListItem } from '../../domain/entities/customer';

export type LoanCustomer = Pick<CustomerListItem, 'id' | 'identification' | 'fullName' | 'primaryPhone'> & {
  address?: string;
};

type NewLoanNavigationState = { customer: LoanCustomer };

export function newLoanNavigationState(customer: CustomerListItem): NewLoanNavigationState {
  return {
    customer: {
      id: customer.id,
      identification: customer.identification,
      fullName: customer.fullName,
      primaryPhone: customer.primaryPhone,
      address: customer.address,
    },
  };
}

export function initialLoanCustomer(state: unknown): LoanCustomer | undefined {
  if (!state || typeof state !== 'object' || !('customer' in state)) return undefined;
  const customer = state.customer;
  if (!customer || typeof customer !== 'object') return undefined;
  if (!('id' in customer) || typeof customer.id !== 'string' || !customer.id) return undefined;
  if (!('identification' in customer) || typeof customer.identification !== 'string') return undefined;
  if (!('fullName' in customer) || typeof customer.fullName !== 'string') return undefined;
  if (!('primaryPhone' in customer) || typeof customer.primaryPhone !== 'string') return undefined;
  const address = 'address' in customer && typeof customer.address === 'string' ? customer.address : undefined;
  return { id: customer.id, identification: customer.identification, fullName: customer.fullName, primaryPhone: customer.primaryPhone, address };
}
