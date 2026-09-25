import { QueryFailedError, Repository } from 'typeorm';
import { CustomerIdentificationAlreadyExistsError } from '../../../../domain/customer/customer.errors';
import type { Customer, CustomerAddress } from '../../../../domain/customer/customer.types';
import type { CreateCustomerAddressInput, CreateCustomerInput, CustomerRepository, CustomerAggregate, CustomerListQuery, CustomerUpdate } from '../../../../application/customer/customer.repository';
import { CustomerAddressOrmEntity, CustomerOrmEntity } from '../entities';
export class CustomerTypeOrmRepository implements CustomerRepository {
  constructor(private readonly customers: Repository<CustomerOrmEntity>, private readonly addresses: Repository<CustomerAddressOrmEntity>) {}
  private mapCustomer(row: CustomerOrmEntity): Customer { return { id: row.id, identificationType: row.identificationType as Customer['identificationType'], identification: row.identification, firstName: row.firstName, middleName: row.middleName ?? undefined, firstLastName: row.firstLastName, secondLastName: row.secondLastName ?? undefined, gender: row.gender as Customer['gender'], birthDate: row.birthDate, primaryPhone: row.primaryPhone, secondaryPhone: row.secondaryPhone ?? undefined, email: row.email ?? undefined, nationality: row.nationality as Customer['nationality'], otherNationality: row.otherNationality ?? undefined, identificationFrontFileKey: row.identificationFrontFileKey ?? null, observations: row.observations ?? undefined, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private mapAddress(row: CustomerAddressOrmEntity): CustomerAddress { return { id: row.id, customerId: row.customerId, districtCode: row.districtCode, exactAddress: row.exactAddress, latitude: row.latitude === null ? undefined : Number(row.latitude), longitude: row.longitude === null ? undefined : Number(row.longitude), propertyPhotoFileKey: row.propertyPhotoFileKey ?? undefined, siteDataUpdatedByUserId: row.siteDataUpdatedByUserId ?? undefined, siteDataUpdatedAt: row.siteDataUpdatedAt ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private mapAggregate(row: CustomerOrmEntity): CustomerAggregate { const address = row.address; const district = address.district; return { customer: this.mapCustomer(row), address: this.mapAddress(address), district: { code: district.code, name: district.name, canton: { code: district.canton.code, name: district.canton.name, province: { code: district.canton.province.code, name: district.canton.province.name } } } }; }
  async findByIdentification(identification: string): Promise<Customer | null> { const row = await this.customers.findOneBy({ identification }); return row ? this.mapCustomer(row) : null; }
  async createWithAddress(customer: CreateCustomerInput, address: CreateCustomerAddressInput): Promise<{ customer: Customer; address: CustomerAddress }> {
    try { return await this.customers.manager.transaction(async (manager) => { const saved = await manager.save(CustomerOrmEntity, manager.create(CustomerOrmEntity, { ...customer, isActive: customer.isActive ?? true })); const savedAddress = await manager.save(CustomerAddressOrmEntity, manager.create(CustomerAddressOrmEntity, { ...address, customerId: saved.id })); return { customer: this.mapCustomer(saved), address: this.mapAddress(savedAddress) }; }); } catch (error) { if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new CustomerIdentificationAlreadyExistsError(); throw error; }
  }
  async list(query: CustomerListQuery): Promise<{ items: { id: string; identification: string; fullName: string; primaryPhone: string; address: string; isActive: boolean }[]; total: number }> {
    const qb = this.customers.createQueryBuilder('customer').leftJoin('customer.address', 'address').select(['customer.id AS id', 'customer.identification AS identification', `CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name) AS "fullName"`, `customer.primary_phone AS "primaryPhone"`, 'address.exact_address AS address', `customer.is_active AS "isActive"`]);
    if (query.status !== 'ALL') qb.andWhere('customer.is_active = :active', { active: query.status === 'ACTIVE' });
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(`(LOWER(customer.identification) LIKE :term OR LOWER(customer.first_name) LIKE :term OR LOWER(customer.middle_name) LIKE :term OR LOWER(customer.first_last_name) LIKE :term OR LOWER(customer.second_last_name) LIKE :term OR LOWER(CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name)) LIKE :term OR LOWER(customer.primary_phone) LIKE :term OR LOWER(customer.secondary_phone) LIKE :term OR LOWER(address.exact_address) LIKE :term OR LOWER(district.name) LIKE :term OR LOWER(canton.name) LIKE :term OR LOWER(province.name) LIKE :term)`, { term });
      qb.leftJoin('address.district', 'district').leftJoin('district.canton', 'canton').leftJoin('canton.province', 'province');
    }
    const [rows, total] = await Promise.all([qb.orderBy('customer.created_at', 'DESC').skip((query.page - 1) * query.pageSize).take(query.pageSize).getRawMany(), qb.getCount()]);
    return { items: rows.map((row) => ({ id: row.id, identification: row.identification, fullName: row.fullName, primaryPhone: row.primaryPhone, address: row.address, isActive: row.isActive === true || row.isActive === 'true' })), total };
  }
  async summary(): Promise<{ totalCustomers: number; maleCustomers: number; femaleCustomers: number; activeLoans: null }> {
    const [total, male, female] = await Promise.all([this.customers.count(), this.customers.countBy({ gender: 'MALE' }), this.customers.countBy({ gender: 'FEMALE' })]);
    return { totalCustomers: total, maleCustomers: male, femaleCustomers: female, activeLoans: null };
  }
  async findAggregateById(id: string): Promise<CustomerAggregate | null> {
    const row = await this.customers.createQueryBuilder('customer').leftJoinAndSelect('customer.address', 'address').leftJoinAndSelect('address.district', 'district').leftJoinAndSelect('district.canton', 'canton').leftJoinAndSelect('canton.province', 'province').where('customer.id = :id', { id }).getOne();
    return row?.address?.district?.canton?.province ? this.mapAggregate(row) : null;
  }
  async updateWithAddress(id: string, customer: CustomerUpdate, address: Partial<CustomerAddress>): Promise<{ aggregate: CustomerAggregate; oldIdentificationKey?: string; oldPropertyKey?: string }> {
    try {
      return await this.customers.manager.transaction(async (manager) => {
        const current = await manager.getRepository(CustomerOrmEntity).createQueryBuilder('customer').leftJoinAndSelect('customer.address', 'address').leftJoinAndSelect('address.district', 'district').leftJoinAndSelect('district.canton', 'canton').leftJoinAndSelect('canton.province', 'province').where('customer.id = :id', { id }).getOneOrFail();
        const oldIdentificationKey = current.identificationFrontFileKey ?? undefined; const oldPropertyKey = current.address.propertyPhotoFileKey ?? undefined;
        const customerPatch: Record<string, unknown> = { ...customer }; delete customerPatch.propertyPhotoFileKey;
        await manager.getRepository(CustomerOrmEntity).update(id, customerPatch);
        if (Object.keys(address).length) await manager.getRepository(CustomerAddressOrmEntity).update(current.address.id, address);
        const updated = await manager.getRepository(CustomerOrmEntity).createQueryBuilder('customer').leftJoinAndSelect('customer.address', 'address').leftJoinAndSelect('address.district', 'district').leftJoinAndSelect('district.canton', 'canton').leftJoinAndSelect('canton.province', 'province').where('customer.id = :id', { id }).getOneOrFail();
        return { aggregate: this.mapAggregate(updated), oldIdentificationKey, oldPropertyKey };
      });
    } catch (error) { if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new CustomerIdentificationAlreadyExistsError(); throw error; }
  }
  async updateStatus(id: string, isActive: boolean): Promise<Customer> { const result = await this.customers.update(id, { isActive }); if (!result.affected) return Promise.reject(new Error('Customer not found')); const row = await this.customers.findOneBy({ id }); return this.mapCustomer(row!); }
  async findFileKey(id: string, kind: 'identification' | 'property'): Promise<string | null> { const row = await this.customers.createQueryBuilder('customer').leftJoin('customer.address', 'address').select(kind === 'identification' ? 'customer.identificationFrontFileKey' : 'address.propertyPhotoFileKey', 'fileKey').where('customer.id = :id', { id }).getRawOne<{ fileKey: string | null }>(); return row?.fileKey ?? null; }
}
