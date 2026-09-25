import { ChangeCustomerStatus, GetCustomer, GetCustomerFile, GetCustomerSummary, ListCustomers, RegisterCustomer, UpdateCustomer } from '../application/use-cases/customer.use-cases';
import { CustomerApi } from '../infrastructure/api/customer.api';
const repository = new CustomerApi();
export const customerUseCases = { register: new RegisterCustomer(repository), list: new ListCustomers(repository), summary: new GetCustomerSummary(repository), get: new GetCustomer(repository), update: new UpdateCustomer(repository), changeStatus: new ChangeCustomerStatus(repository), file: new GetCustomerFile(repository) };
