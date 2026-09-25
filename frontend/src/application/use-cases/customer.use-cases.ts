import type { CustomerCreated, CustomerDetail, CustomerForm } from '../../domain/entities/customer';
import type { CustomerRepository } from '../ports/customer.repository';
export class RegisterCustomer { constructor(private readonly repository: CustomerRepository) {} execute(input: CustomerForm): Promise<CustomerCreated> { return this.repository.create(input); } }
export class ListCustomers { constructor(private readonly repository: CustomerRepository) {} execute(query: Parameters<CustomerRepository['list']>[0]) { return this.repository.list(query); } }
export class GetCustomer { constructor(private readonly repository: CustomerRepository) {} execute(id: string): Promise<CustomerDetail> { return this.repository.detail(id); } }
export class GetCustomerSummary { constructor(private readonly repository: CustomerRepository) {} execute() { return this.repository.summary(); } }
export class UpdateCustomer { constructor(private readonly repository: CustomerRepository) {} execute(id: string, input: Partial<CustomerForm>) { return this.repository.update(id, input); } }
export class ChangeCustomerStatus { constructor(private readonly repository: CustomerRepository) {} execute(id: string, active: boolean) { return this.repository.changeStatus(id, active); } }
export class GetCustomerFile { constructor(private readonly repository: CustomerRepository) {} execute(id: string, kind: 'identification' | 'property') { return this.repository.file(id, kind); } }
