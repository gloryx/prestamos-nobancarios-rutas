import { QueryFailedError, Repository } from 'typeorm';
import { CustomerIdentificationAlreadyExistsError } from '../../../../domain/customer/customer.errors';
import type { Customer, CustomerAddress } from '../../../../domain/customer/customer.types';
import type { CreateCustomerAddressInput, CreateCustomerInput, CustomerRepository, CustomerAggregate, CustomerExportItem, CustomerListQuery, CustomerSummary, CustomerSummaryQuery, CustomerUpdate } from '../../../../application/customer/customer.repository';
import { CustomerAddressOrmEntity, CustomerOrmEntity } from '../entities';
export const CUSTOMER_SORT_COLUMNS = { identification: 'LOWER(customer.identification)', name: `LOWER(CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name))`, phone: 'customer.primary_phone', address: 'LOWER(address.exact_address)', status: 'customer.is_active' } as const;
export const customerSortColumn = (sortBy: keyof typeof CUSTOMER_SORT_COLUMNS | undefined): string | undefined => sortBy ? CUSTOMER_SORT_COLUMNS[sortBy] : undefined;
export class CustomerTypeOrmRepository implements CustomerRepository {
  constructor(private readonly customers: Repository<CustomerOrmEntity>, private readonly addresses: Repository<CustomerAddressOrmEntity>) {}
  private mapCustomer(row: CustomerOrmEntity): Customer { return { id: row.id, identificationType: row.identificationType as Customer['identificationType'], identification: row.identification, firstName: row.firstName, middleName: row.middleName ?? undefined, firstLastName: row.firstLastName, secondLastName: row.secondLastName ?? undefined, gender: row.gender as Customer['gender'], birthDate: row.birthDate, primaryPhone: row.primaryPhone, secondaryPhone: row.secondaryPhone ?? undefined, email: row.email ?? undefined, nationality: row.nationality as Customer['nationality'], otherNationality: row.otherNationality ?? undefined, identificationFrontFileKey: row.identificationFrontFileKey ?? null, observations: row.observations ?? undefined, isActive: row.isActive, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private mapAddress(row: CustomerAddressOrmEntity): CustomerAddress { return { id: row.id, customerId: row.customerId, districtCode: row.districtCode, exactAddress: row.exactAddress, latitude: row.latitude === null ? undefined : Number(row.latitude), longitude: row.longitude === null ? undefined : Number(row.longitude), propertyPhotoFileKey: row.propertyPhotoFileKey ?? undefined, siteDataUpdatedByUserId: row.siteDataUpdatedByUserId ?? undefined, siteDataUpdatedAt: row.siteDataUpdatedAt ?? undefined, createdAt: row.createdAt, updatedAt: row.updatedAt }; }
  private mapAggregate(row: CustomerOrmEntity): CustomerAggregate { const address = row.address; const district = address.district; return { customer: this.mapCustomer(row), address: this.mapAddress(address), district: { code: district.code, name: district.name, canton: { code: district.canton.code, name: district.canton.name, province: { code: district.canton.province.code, name: district.canton.province.name } } } }; }
  async findByIdentification(identification: string): Promise<Customer | null> { const row = await this.customers.findOneBy({ identification }); return row ? this.mapCustomer(row) : null; }
  async createWithAddress(customer: CreateCustomerInput, address: CreateCustomerAddressInput): Promise<{ customer: Customer; address: CustomerAddress }> {
    try { return await this.customers.manager.transaction(async (manager) => { const saved = await manager.save(CustomerOrmEntity, manager.create(CustomerOrmEntity, { ...customer, isActive: customer.isActive ?? true })); const savedAddress = await manager.save(CustomerAddressOrmEntity, manager.create(CustomerAddressOrmEntity, { ...address, customerId: saved.id })); return { customer: this.mapCustomer(saved), address: this.mapAddress(savedAddress) }; }); } catch (error) { if (error instanceof QueryFailedError && (error as { driverError?: { code?: string } }).driverError?.code === '23505') throw new CustomerIdentificationAlreadyExistsError(); throw error; }
  }
  private scopedQuery(query: CustomerSummaryQuery) {
    const qb = this.customers.createQueryBuilder('customer').leftJoin('customer.address', 'address');
    if (query.status !== 'ALL') qb.andWhere('customer.is_active = :active', { active: query.status === 'ACTIVE' });
    if (query.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.andWhere(`(LOWER(customer.identification) LIKE :term OR LOWER(customer.first_name) LIKE :term OR LOWER(customer.middle_name) LIKE :term OR LOWER(customer.first_last_name) LIKE :term OR LOWER(customer.second_last_name) LIKE :term OR LOWER(CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name)) LIKE :term OR LOWER(customer.primary_phone) LIKE :term OR LOWER(customer.secondary_phone) LIKE :term OR LOWER(address.exact_address) LIKE :term OR LOWER(district.name) LIKE :term OR LOWER(canton.name) LIKE :term OR LOWER(province.name) LIKE :term)`, { term });
      qb.leftJoin('address.district', 'district').leftJoin('district.canton', 'canton').leftJoin('canton.province', 'province');
    }
    return qb;
  }
  async list(query: CustomerListQuery): Promise<{ items: { id: string; identification: string; fullName: string; primaryPhone: string; address: string; isActive: boolean }[]; total: number }> {
    const qb = this.scopedQuery(query).select(['customer.id AS id', 'customer.identification AS identification', `CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name) AS "fullName"`, `customer.primary_phone AS "primaryPhone"`, 'address.exact_address AS address', `customer.is_active AS "isActive"`]);
    const sortColumn = customerSortColumn(query.sortBy);
    if (sortColumn) { const requestedOrder = query.sortOrder ?? 'asc'; const databaseOrder = requestedOrder === 'asc' ? 'ASC' : 'DESC'; qb.orderBy(sortColumn, query.sortBy === 'status' ? (databaseOrder === 'ASC' ? 'DESC' : 'ASC') : databaseOrder).addOrderBy('customer.id', 'ASC'); }
    else qb.orderBy('customer.created_at', 'DESC').addOrderBy('customer.id', 'DESC');
    const [rows, total] = await Promise.all([qb.skip((query.page - 1) * query.pageSize).take(query.pageSize).getRawMany(), qb.getCount()]);
    return { items: rows.map((row) => ({ id: row.id, identification: row.identification, fullName: row.fullName, primaryPhone: row.primaryPhone, address: row.address, isActive: row.isActive === true || row.isActive === 'true' })), total };
  }
  async exportAll(): Promise<CustomerExportItem[]> {
    const rows = await this.customers.createQueryBuilder('customer')
      .leftJoin('customer.address', 'address').leftJoin('address.district', 'district')
      .leftJoin('district.canton', 'canton').leftJoin('canton.province', 'province')
      .select(['customer.identification AS identification', `CONCAT_WS(' ', customer.first_name, customer.middle_name, customer.first_last_name, customer.second_last_name) AS "fullName"`,
        `customer.primary_phone AS "primaryPhone"`, 'province.name AS province', 'canton.name AS canton', 'district.name AS district', `customer.is_active AS "isActive"`])
      .orderBy(CUSTOMER_SORT_COLUMNS.name, 'ASC').addOrderBy('customer.id', 'ASC').getRawMany();
    return rows.map((row) => ({ identification: row.identification, fullName: row.fullName, primaryPhone: row.primaryPhone,
      province: row.province ?? '', canton: row.canton ?? '', district: row.district ?? '', isActive: row.isActive === true || row.isActive === 'true' }));
  }
  async summary(query: CustomerSummaryQuery = { status: 'ALL' }): Promise<CustomerSummary> {
    const row = await this.scopedQuery(query).select([
      'COUNT(DISTINCT customer.id) AS "totalCustomers"',
      `COUNT(DISTINCT customer.id) FILTER (WHERE customer.gender = 'MALE') AS "maleCustomers"`,
      `COUNT(DISTINCT customer.id) FILTER (WHERE customer.gender = 'FEMALE') AS "femaleCustomers"`,
      `COUNT(DISTINCT customer.id) FILTER (WHERE EXISTS (SELECT 1 FROM loans loan WHERE loan.customer_id = customer.id AND loan.status = 'ACTIVE')) AS "customersWithActiveLoans"`,
    ]).getRawOne<{ totalCustomers: string; maleCustomers: string; femaleCustomers: string; customersWithActiveLoans: string }>();
    return { totalCustomers: Number(row?.totalCustomers ?? 0), maleCustomers: Number(row?.maleCustomers ?? 0), femaleCustomers: Number(row?.femaleCustomers ?? 0), customersWithActiveLoans: Number(row?.customersWithActiveLoans ?? 0) };
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
