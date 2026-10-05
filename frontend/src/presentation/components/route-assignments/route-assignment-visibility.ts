import type { AssignmentWorkspaceCustomer } from '../../../domain/entities/route-assignment';

const matches = (customer: AssignmentWorkspaceCustomer, search: string) => !search.trim() ||
  `${customer.name} ${customer.identification} ${customer.phone}`.toLocaleLowerCase().includes(search.trim().toLocaleLowerCase());

export const filterVisibleCustomers = (customers: AssignmentWorkspaceCustomer[], search: string, serverPaged: boolean): AssignmentWorkspaceCustomer[] => serverPaged ? customers : customers.filter((customer) => matches(customer, search));
