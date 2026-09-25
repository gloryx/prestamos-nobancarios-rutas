import type { Customer, CustomerAddress } from '../../domain/customer/customer.types';

export type CreateCustomerInput = Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'isActive'> & { isActive?: boolean };
export type CreateCustomerAddressInput = Omit<CustomerAddress, 'id' | 'createdAt' | 'updatedAt'>;
export type CustomerAggregate = { customer: Customer; address: CustomerAddress; district: { code: number; name: string; canton: { code: number; name: string; province: { code: number; name: string } } } };
export type CustomerListItem = { id: string; identification: string; fullName: string; primaryPhone: string; address: string; isActive: boolean };
export type CustomerListQuery = { search?: string; status: 'ACTIVE' | 'INACTIVE' | 'ALL'; page: number; pageSize: 10 | 20 | 50 };
export type CustomerUpdate = Partial<Omit<Customer, 'id' | 'createdAt' | 'updatedAt' | 'identificationFrontFileKey' | 'isActive'>> & Partial<Pick<CustomerAddress, 'districtCode' | 'exactAddress' | 'latitude' | 'longitude'>> & { identificationFrontFileKey?: string | null; propertyPhotoFileKey?: string };

export interface CustomerRepository {
  findByIdentification(identification: string): Promise<Customer | null>;
  createWithAddress(customer: CreateCustomerInput, address: CreateCustomerAddressInput): Promise<{ customer: Customer; address: CustomerAddress }>;
  list(query: CustomerListQuery): Promise<{ items: CustomerListItem[]; total: number }>;
  summary(): Promise<{ totalCustomers: number; maleCustomers: number; femaleCustomers: number; activeLoans: null }>;
  findAggregateById(id: string): Promise<CustomerAggregate | null>;
  updateWithAddress(id: string, customer: CustomerUpdate, address: Partial<CustomerAddress>): Promise<{ aggregate: CustomerAggregate; oldIdentificationKey?: string; oldPropertyKey?: string }>;
  updateStatus(id: string, isActive: boolean): Promise<Customer>;
  findFileKey(id: string, kind: 'identification' | 'property'): Promise<string | null>;
}
export const CUSTOMER_REPOSITORY = Symbol('CUSTOMER_REPOSITORY');
