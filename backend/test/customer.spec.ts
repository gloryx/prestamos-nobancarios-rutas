import { CustomerValidationError } from '../src/domain/customer/customer.errors';
import { CustomerManagementUseCase, normalizeForeignIdentification, normalizeNationalIdentification, RegisterCustomerUseCase } from '../src/application/customer/customer.use-case';
describe('customer registration', () => {
  it('persists null and does not save an identification file when omitted', async () => {
    const saved: string[] = [];
    let persisted: Record<string, unknown> | undefined;
    const useCase = new RegisterCustomerUseCase({ findByIdentification: async () => null, createWithAddress: async (customer) => { persisted = customer; return { customer: { ...customer, id: 'id', isActive: true, createdAt: new Date(), updatedAt: new Date() }, address: {} } as never; } }, { save: async (_, key) => { saved.push(key); }, delete: async () => undefined }, async () => true);
    await useCase.execute({ identificationType: 'NATIONAL', identification: '1-1234-5678', firstName: 'Ana', firstLastName: 'Lopez', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: '8888', nationality: 'COSTA_RICAN', districtCode: 10101, exactAddress: 'Casa' });
    expect(persisted?.identificationFrontFileKey).toBeNull();
    expect(saved).toEqual([]);
  });

  it('normalizes identification values', () => {
    expect(normalizeNationalIdentification('1-1234-5678')).toBe('112345678');
    expect(normalizeForeignIdentification(' ab-12  3 ')).toBe('AB-12  3');
  });
  it('rejects invalid national identification', () => { expect(() => normalizeNationalIdentification('123')).toThrow(CustomerValidationError); });
  it('cleans files if persistence fails', async () => {
    const saved: string[] = []; const deleted: string[] = [];
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0]), mimetype: 'image/jpeg', size: 4 };
    const useCase = new RegisterCustomerUseCase({ findByIdentification: async () => null, createWithAddress: async () => { throw new Error('persistence'); } }, { save: async (_, key) => { saved.push(key); }, delete: async (key) => { deleted.push(key); } }, async () => true);
    await expect(useCase.execute({ identificationType: 'NATIONAL', identification: '1-1234-5678', firstName: 'Ana', firstLastName: 'Lopez', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: '8888', nationality: 'COSTA_RICAN', districtCode: 10101, exactAddress: 'Casa', identificationFront: file })).rejects.toThrow('persistence');
    expect(saved).toHaveLength(1); expect(deleted).toEqual(saved);
  });

  it('normalizes business text before persistence', async () => {
    let persistedCustomer: Record<string, unknown> | undefined;
    let persistedAddress: Record<string, unknown> | undefined;
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0]), mimetype: 'image/jpeg', size: 4 };
    const useCase = new RegisterCustomerUseCase(
      {
        findByIdentification: async () => null,
        createWithAddress: async (customer, address) => {
          persistedCustomer = customer;
          persistedAddress = address;
          return { customer: { ...customer, id: 'customer-id', isActive: true, createdAt: new Date(), updatedAt: new Date() }, address: { ...address, id: 'address-id', createdAt: new Date(), updatedAt: new Date() } } as never;
        },
      },
      { save: async () => undefined, delete: async () => undefined },
      async () => true,
    );

    await useCase.execute({ identificationType: 'NATIONAL', identification: ' 1-1234-5678 ', firstName: ' Pérez  María ', middleName: ' José ', firstLastName: ' Muñoz ', secondLastName: ' López ', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: ' 8888 ', secondaryPhone: ' 7777 ', email: '  Persona@Example.COM ', nationality: 'OTHER', otherNationality: ' nicaragüense ', districtCode: 10101, exactAddress: ' Casa 12,  detrás del parque ', observations: ' visita en la tarde\n  confirmar horario ', identificationFront: file });

    expect(persistedCustomer).toMatchObject({ identification: '112345678', firstName: 'PÉREZ  MARÍA', middleName: 'JOSÉ', firstLastName: 'MUÑOZ', secondLastName: 'LÓPEZ', primaryPhone: '8888', secondaryPhone: '7777', email: 'persona@example.com', otherNationality: 'NICARAGÜENSE', observations: 'VISITA EN LA TARDE\n  CONFIRMAR HORARIO' });
    expect(persistedAddress).toMatchObject({ exactAddress: 'CASA 12,  DETRÁS DEL PARQUE' });
  });

  it('normalizes a foreign identification without changing its separators or digits', async () => {
    expect(normalizeForeignIdentification('  ab-é-12  3  ')).toBe('AB-É-12  3');
    expect(normalizeForeignIdentification(' n 12345678 ')).toBe('N 12345678');
  });

  it('normalizes editable business fields while preserving phone values', async () => {
    const saved: string[] = [];
    const aggregate = { customer: { id: 'id', identificationType: 'NATIONAL', identification: '112345678', firstName: 'ANA', firstLastName: 'PEREZ', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: ' 8888 ', nationality: 'COSTA_RICAN', identificationFrontFileKey: 'clientes/identificaciones/112345678.jpg', isActive: true, createdAt: new Date(), updatedAt: new Date() }, address: { id: 'address', customerId: 'id', districtCode: 10101, exactAddress: 'CASA', createdAt: new Date(), updatedAt: new Date(), propertyPhotoFileKey: 'clientes/casas-negocios/112345678.jpg' }, district: { code: 10101, name: 'DISTRITO', canton: { code: 101, name: 'CANTON', province: { code: 1, name: 'PROVINCIA' } } } } as never;
    const repository = { findAggregateById: async () => aggregate, findByIdentification: async () => null, updateWithAddress: async (_id: string, customer: Record<string, unknown>, address: Record<string, unknown>) => { expect(customer.firstName).toBe('MARIA'); expect(customer.primaryPhone).toBe('9999'); expect(address.exactAddress).toBe('NUEVA CASA'); return { aggregate, oldIdentificationKey: 'old.jpg' }; }, list: async () => ({ items: [], total: 0 }), summary: async () => ({ totalCustomers: 0, maleCustomers: 0, femaleCustomers: 0, activeLoans: null }), updateStatus: async () => (aggregate as any).customer, findFileKey: async () => null } as never;
    const useCase = new CustomerManagementUseCase(repository, { save: async (_file, key) => { saved.push(key); }, read: async () => ({ buffer: Buffer.alloc(0), mimetype: 'image/jpeg' }), replace: async () => undefined, delete: async () => undefined }, async () => true);
    await useCase.update('id', { firstName: ' maria ', primaryPhone: '9999', exactAddress: ' nueva casa ' });
    expect(saved).toHaveLength(0);
  });

  it('cleans replacement files when persistence fails', async () => {
    const deleted: string[] = [];
    const aggregate = { customer: { id: 'id', identificationType: 'NATIONAL', identification: '112345678', firstName: 'ANA', firstLastName: 'PEREZ', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: '8888', nationality: 'COSTA_RICAN', identificationFrontFileKey: 'old.jpg', isActive: true, createdAt: new Date(), updatedAt: new Date() }, address: { id: 'address', customerId: 'id', districtCode: 10101, exactAddress: 'CASA', createdAt: new Date(), updatedAt: new Date() }, district: { code: 10101, name: 'DISTRITO', canton: { code: 101, name: 'CANTON', province: { code: 1, name: 'PROVINCIA' } } } } as never;
    const repository = { findAggregateById: async () => aggregate, updateWithAddress: async () => { throw new Error('persistence'); } } as never;
    const useCase = new CustomerManagementUseCase(repository, { save: async () => undefined, read: async () => ({ buffer: Buffer.alloc(0), mimetype: 'image/jpeg' }), replace: async () => undefined, delete: async (key) => { deleted.push(key); } }, async () => true);
    const file = { buffer: Buffer.from([0xff, 0xd8, 0xff, 0]), mimetype: 'image/jpeg', size: 4 };
    await expect(useCase.update('id', { identificationFront: file })).rejects.toThrow('persistence');
    expect(deleted).toHaveLength(1);
  });

  it('uses the normalized identification for deterministic replacement keys and migrates both files when it changes', async () => {
    const saved: string[] = [];
    const aggregate = { customer: { id: 'id', identificationType: 'FOREIGN', identification: 'OLD ID', firstName: 'ANA', firstLastName: 'PEREZ', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: '8888', nationality: 'COSTA_RICAN', identificationFrontFileKey: 'clientes/identificaciones/OLD_ID.jpg', isActive: true, createdAt: new Date(), updatedAt: new Date() }, address: { id: 'address', customerId: 'id', districtCode: 10101, exactAddress: 'CASA', propertyPhotoFileKey: 'clientes/casas-negocios/OLD_ID.png', createdAt: new Date(), updatedAt: new Date() }, district: { code: 10101, name: 'DISTRITO', canton: { code: 101, name: 'CANTON', province: { code: 1, name: 'PROVINCIA' } } } } as never;
    let persistedCustomer: Record<string, unknown> | undefined;
    let persistedAddress: Record<string, unknown> | undefined;
    const repository = { findAggregateById: async () => aggregate, findByIdentification: async () => null, updateWithAddress: async (_id: string, customer: Record<string, unknown>, address: Record<string, unknown>) => { persistedCustomer = customer; persistedAddress = address; return { aggregate, oldIdentificationKey: 'clientes/identificaciones/OLD_ID.jpg', oldPropertyKey: 'clientes/casas-negocios/OLD_ID.png' }; } } as never;
    const useCase = new CustomerManagementUseCase(repository, { save: async (_file, key) => { saved.push(key); }, read: async (key) => ({ buffer: Buffer.from(key), mimetype: key.endsWith('.png') ? 'image/png' : 'image/jpeg' }), replace: async () => undefined, delete: async () => undefined }, async () => true);
    await useCase.update('id', { identification: ' nuevo 123 ' });
    expect(saved).toEqual(['clientes/identificaciones/NUEVO_123.jpg', 'clientes/casas-negocios/NUEVO_123.png']);
    expect(persistedCustomer).toMatchObject({ identification: 'NUEVO 123', identificationFrontFileKey: 'clientes/identificaciones/NUEVO_123.jpg' });
    expect(persistedAddress).toMatchObject({ propertyPhotoFileKey: 'clientes/casas-negocios/NUEVO_123.png' });
  });

  it('allows clearing otherNationality when changing nationality away from OTHER', async () => {
    const aggregate = { customer: { id: 'id', identificationType: 'NATIONAL', identification: '112345678', firstName: 'ANA', firstLastName: 'PEREZ', gender: 'FEMALE', birthDate: '1990-01-01', primaryPhone: '8888', nationality: 'OTHER', otherNationality: 'NICARAGUENSE', identificationFrontFileKey: 'clientes/identificaciones/112345678.jpg', isActive: true, createdAt: new Date(), updatedAt: new Date() }, address: { id: 'address', customerId: 'id', districtCode: 10101, exactAddress: 'CASA', createdAt: new Date(), updatedAt: new Date() }, district: { code: 10101, name: 'DISTRITO', canton: { code: 101, name: 'CANTON', province: { code: 1, name: 'PROVINCIA' } } } } as never;
    let persisted: Record<string, unknown> | undefined;
    const repository = { findAggregateById: async () => aggregate, updateWithAddress: async (_id: string, customer: Record<string, unknown>) => { persisted = customer; return { aggregate }; } } as never;
    const useCase = new CustomerManagementUseCase(repository, { save: async () => undefined, read: async () => ({ buffer: Buffer.alloc(0), mimetype: 'image/jpeg' }), replace: async () => undefined, delete: async () => undefined }, async () => true);
    await useCase.update('id', { nationality: 'COSTA_RICAN', otherNationality: '' });
    expect(persisted).toMatchObject({ nationality: 'COSTA_RICAN', otherNationality: undefined });
  });
});
