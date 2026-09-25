import { CustomerFileNotFoundError, CustomerIdentificationAlreadyExistsError, CustomerNotFoundError, CustomerValidationError, DistrictNotFoundError } from '../../domain/customer/customer.errors';
import type { CustomerAggregate, CustomerListQuery, CustomerRepository, CustomerUpdate } from './customer.repository';
import type { Gender, IdentificationType, Nationality } from '../../domain/customer/customer.types';
import type { FileStorage, RegistrationFileStorage, UploadFile } from './file-storage';
import { normalizeBusinessText, normalizeEmail, normalizeForeignIdentification, normalizeNationalIdentification, normalizeOptionalBusinessText } from './customer.normalization';

export type RegisterCustomerInput = {
  identificationType: IdentificationType; identification: string; firstName: string; middleName?: string; firstLastName: string; secondLastName?: string;
  gender: Gender; birthDate: string; primaryPhone: string; secondaryPhone?: string; email?: string; nationality: Nationality; otherNationality?: string;
  districtCode: number; exactAddress: string; latitude?: number; longitude?: number; observations?: string; identificationFront: UploadFile; propertyPhoto?: UploadFile;
};

export { normalizeForeignIdentification, normalizeNationalIdentification } from './customer.normalization';

const required = (value: string | undefined, label: string): string => { const result = value === undefined ? '' : normalizeBusinessText(value); if (!result) throw new CustomerValidationError(`${label} es requerido.`); return result; };
const optional = (value?: string): string | undefined => normalizeOptionalBusinessText(value);
const allowed = <T extends string>(value: string, values: readonly T[], label: string): T => { if (!values.includes(value as T)) throw new CustomerValidationError(`${label} no es válido.`); return value as T; };
const fileIsValid = (file: UploadFile | undefined, requiredFile: boolean, label: string): void => {
  if (!file) { if (requiredFile) throw new CustomerValidationError(`${label} es requerido.`); return; }
  if (file.size > 5 * 1024 * 1024) throw new CustomerValidationError(`${label} no puede superar 5 MB.`);
  const b = file.buffer; const isJpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const isPng = b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  const isWebp = b.length > 12 && b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP';
  if (!(isJpeg || isPng || isWebp) || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype ?? '')) throw new CustomerValidationError(`${label} debe ser JPEG, PNG o WEBP válido.`);
};
const safeFileExtension = (file: UploadFile): string => file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
const safeFileId = (value: string): string => value.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^\.+/, '').slice(0, 40);

export class RegisterCustomerUseCase {
  constructor(private readonly repository: Pick<CustomerRepository, 'findByIdentification' | 'createWithAddress'>, private readonly storage: RegistrationFileStorage, private readonly districtExists: (code: number) => Promise<boolean>) {}
  async execute(input: RegisterCustomerInput) {
    const identificationType = allowed(input.identificationType, ['NATIONAL', 'FOREIGN'] as const, 'El tipo de identificación');
    const identification = identificationType === 'NATIONAL' ? normalizeNationalIdentification(input.identification) : normalizeForeignIdentification(input.identification);
    const firstName = required(input.firstName, 'El nombre'); const middleName = optional(input.middleName); const firstLastName = required(input.firstLastName, 'El primer apellido'); const secondLastName = optional(input.secondLastName);
    const gender = allowed(input.gender, ['MALE', 'FEMALE'] as const, 'El género'); const nationality = allowed(input.nationality, ['COSTA_RICAN', 'NICARAGUAN', 'PANAMANIAN', 'HONDURAN', 'OTHER'] as const, 'La nacionalidad');
    const birthDate = required(input.birthDate, 'La fecha de nacimiento'); const date = new Date(`${birthDate}T00:00:00Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(birthDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== birthDate || date > new Date()) throw new CustomerValidationError('La fecha de nacimiento no es válida.');
    const email = normalizeEmail(input.email); if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new CustomerValidationError('El correo electrónico no es válido.');
    const otherNationality = optional(input.otherNationality); if (nationality === 'OTHER' && !otherNationality) throw new CustomerValidationError('Debe indicar la otra nacionalidad.');
    if (nationality !== 'OTHER' && otherNationality) throw new CustomerValidationError('La otra nacionalidad solo aplica para Otro.');
    if (!Number.isInteger(input.districtCode) || !(await this.districtExists(input.districtCode))) throw new DistrictNotFoundError();
    if ((input.latitude === undefined) !== (input.longitude === undefined)) throw new CustomerValidationError('Debe indicar latitud y longitud juntas.');
    if (input.latitude !== undefined && (input.latitude < -90 || input.latitude > 90 || input.longitude! < -180 || input.longitude! > 180)) throw new CustomerValidationError('Las coordenadas no son válidas.');
    fileIsValid(input.identificationFront, true, 'La identificación frontal'); fileIsValid(input.propertyPhoto, false, 'La foto del inmueble');
    const existing = await this.repository.findByIdentification(identification); if (existing) throw new CustomerIdentificationAlreadyExistsError();
    const keyBase = safeFileId(identification); const identificationKey = `clientes/identificaciones/${keyBase}.${safeFileExtension(input.identificationFront)}`; const propertyKey = input.propertyPhoto ? `clientes/casas-negocios/${keyBase}.${safeFileExtension(input.propertyPhoto)}` : undefined;
    const createdKeys: string[] = [];
    try {
      await this.storage.save(input.identificationFront, identificationKey); createdKeys.push(identificationKey);
      if (input.propertyPhoto && propertyKey) { await this.storage.save(input.propertyPhoto, propertyKey); createdKeys.push(propertyKey); }
      const result = await this.repository.createWithAddress({ identificationType, identification, firstName, middleName, firstLastName, secondLastName, gender, birthDate, primaryPhone: input.primaryPhone.trim(), secondaryPhone: input.secondaryPhone?.trim() || undefined, email, nationality, otherNationality, identificationFrontFileKey: identificationKey, observations: optional(input.observations) }, { customerId: '', districtCode: input.districtCode, exactAddress: required(input.exactAddress, 'La dirección exacta'), latitude: input.latitude, longitude: input.longitude, propertyPhotoFileKey: propertyKey });
      return { id: result.customer.id, identificationType, identification, fullName: [firstName, middleName, firstLastName, secondLastName].filter(Boolean).join(' '), isActive: result.customer.isActive, address: result.address };
    } catch (error) { await Promise.allSettled(createdKeys.map((key) => this.storage.delete(key))); throw error; }
  }
}

export type UpdateCustomerInput = Partial<Omit<RegisterCustomerInput, 'identificationFront' | 'propertyPhoto' | 'districtCode'>> & { identificationType?: IdentificationType; identification?: string; districtCode?: number; identificationFront?: UploadFile; propertyPhoto?: UploadFile };
export type CustomerDetailOutput = Omit<CustomerAggregate, 'customer' | 'address'> & { customer: Omit<CustomerAggregate['customer'], 'identificationFrontFileKey'>; address: Omit<CustomerAggregate['address'], 'propertyPhotoFileKey'> };

const detailOutput = (aggregate: CustomerAggregate): CustomerDetailOutput => ({ customer: Object.fromEntries(Object.entries(aggregate.customer).filter(([key]) => key !== 'identificationFrontFileKey')) as CustomerDetailOutput['customer'], address: Object.fromEntries(Object.entries(aggregate.address).filter(([key]) => key !== 'propertyPhotoFileKey')) as CustomerDetailOutput['address'], district: aggregate.district });
const extension = (file: UploadFile): string => file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
const extensionFromKey = (key: string): string => key.split('.').pop()?.toLowerCase() || 'jpg';
const safeFilenameIdentification = (identification: string): string => { const safe = identification.replace(/[^A-Za-z0-9_-]/g, '_').replace(/^\.+/, '').slice(0, 80); return safe || 'identification'; };
const replacementKey = (identification: string, folder: string, fileOrExtension: UploadFile | string): string => `clientes/${folder}/${safeFilenameIdentification(identification)}.${typeof fileOrExtension === 'string' ? fileOrExtension : extension(fileOrExtension)}`;

export class CustomerManagementUseCase {
  constructor(private readonly repository: CustomerRepository, private readonly storage: FileStorage, private readonly districtExists: (code: number) => Promise<boolean>) {}
  async list(query: CustomerListQuery) { const result = await this.repository.list(query); return { ...result, page: query.page, pageSize: query.pageSize, totalPages: Math.ceil(result.total / query.pageSize) }; }
  async summary() { return this.repository.summary(); }
  async detail(id: string) { const result = await this.repository.findAggregateById(id); if (!result) throw new CustomerNotFoundError(); return detailOutput(result); }
  async status(id: string, isActive: boolean) { try { return await this.repository.updateStatus(id, isActive); } catch { throw new CustomerNotFoundError(); } }
  async file(id: string, kind: 'identification' | 'property') { const key = await this.repository.findFileKey(id, kind); if (!key) throw new CustomerFileNotFoundError(); try { return await this.storage.read(key); } catch { throw new CustomerFileNotFoundError(); } }
  async update(id: string, input: UpdateCustomerInput) {
    const current = await this.repository.findAggregateById(id); if (!current) throw new CustomerNotFoundError();
    const customer: CustomerUpdate = {};
    if (input.identificationType !== undefined) customer.identificationType = allowed(input.identificationType, ['NATIONAL', 'FOREIGN'] as const, 'El tipo de identificación');
    if (input.identification !== undefined || input.identificationType !== undefined) { const value = input.identification ?? current.customer.identification; customer.identification = (customer.identificationType ?? current.customer.identificationType) === 'NATIONAL' ? normalizeNationalIdentification(value) : normalizeForeignIdentification(value); }
    if (customer.identification && customer.identification !== current.customer.identification) { const duplicate = await this.repository.findByIdentification(customer.identification); if (duplicate && duplicate.id !== id) throw new CustomerIdentificationAlreadyExistsError(); }
    for (const field of ['firstName', 'middleName', 'firstLastName', 'secondLastName', 'otherNationality', 'observations'] as const) if (input[field] !== undefined) customer[field] = field === 'firstName' || field === 'firstLastName' ? required(input[field], field) : optional(input[field]);
    if (input.gender !== undefined) customer.gender = allowed(input.gender, ['MALE', 'FEMALE'] as const, 'El género');
    if (input.nationality !== undefined) customer.nationality = allowed(input.nationality, ['COSTA_RICAN', 'NICARAGUAN', 'PANAMANIAN', 'HONDURAN', 'OTHER'] as const, 'La nacionalidad');
    if (input.birthDate !== undefined) { const date = new Date(`${input.birthDate}T00:00:00Z`); if (!/^\d{4}-\d{2}-\d{2}$/.test(input.birthDate) || Number.isNaN(date.valueOf()) || date.toISOString().slice(0, 10) !== input.birthDate || date > new Date()) throw new CustomerValidationError('La fecha de nacimiento no es válida.'); customer.birthDate = input.birthDate; }
    if (input.primaryPhone !== undefined) customer.primaryPhone = input.primaryPhone.trim(); if (input.secondaryPhone !== undefined) customer.secondaryPhone = input.secondaryPhone.trim() || undefined;
    if (input.email !== undefined) { customer.email = normalizeEmail(input.email); if (customer.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email)) throw new CustomerValidationError('El correo electrónico no es válido.'); }
    const nationality = customer.nationality ?? current.customer.nationality; const otherNationality = Object.prototype.hasOwnProperty.call(customer, 'otherNationality') ? customer.otherNationality : current.customer.otherNationality; if (nationality === 'OTHER' && !otherNationality) throw new CustomerValidationError('Debe indicar la otra nacionalidad.'); if (nationality !== 'OTHER' && otherNationality) throw new CustomerValidationError('La otra nacionalidad solo aplica para Otro.');
    const address: CustomerUpdate = {};
    if (input.districtCode !== undefined) { if (!Number.isInteger(input.districtCode) || !(await this.districtExists(input.districtCode))) throw new DistrictNotFoundError(); address.districtCode = input.districtCode; }
    if (input.exactAddress !== undefined) address.exactAddress = required(input.exactAddress, 'La dirección exacta');
    if (input.latitude !== undefined || input.longitude !== undefined) { const latitude = input.latitude ?? current.address.latitude; const longitude = input.longitude ?? current.address.longitude; if (latitude === undefined || longitude === undefined || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) throw new CustomerValidationError('Las coordenadas no son válidas.'); address.latitude = latitude; address.longitude = longitude; }
    const files: string[] = []; const replacements: { file: UploadFile; key: string }[] = []; const newKeys: { identification?: string; property?: string } = {}; const identification = customer.identification ?? current.customer.identification;
    try {
      fileIsValid(input.identificationFront, false, 'La identificación frontal'); fileIsValid(input.propertyPhoto, false, 'La foto del inmueble');
      const prepare = async (file: UploadFile | undefined, folder: string, currentKey: string | undefined, target: (key: string) => void): Promise<void> => { const deterministicKey = currentKey ? replacementKey(identification, folder, extensionFromKey(currentKey)) : undefined; const targetKey = file ? replacementKey(identification, folder, file) : currentKey && currentKey !== deterministicKey ? deterministicKey : currentKey; if (!targetKey) return; target(targetKey); if (targetKey === currentKey) { if (file) replacements.push({ file, key: targetKey }); return; } if (file) await this.storage.save(file, targetKey); else if (currentKey) { const old = await this.storage.read(currentKey); await this.storage.save({ buffer: old.buffer, mimetype: old.mimetype, size: old.buffer.length }, targetKey); } files.push(targetKey); };
      await prepare(input.identificationFront, 'identificaciones', current.customer.identificationFrontFileKey, (key) => { newKeys.identification = key; customer.identificationFrontFileKey = key; });
      await prepare(input.propertyPhoto, 'casas-negocios', current.address.propertyPhotoFileKey, (key) => { newKeys.property = key; address.propertyPhotoFileKey = key; });
      const result = await this.repository.updateWithAddress(id, customer, address); await Promise.all(replacements.map(({ file, key }) => this.storage.replace(file, key))); await Promise.allSettled([result.oldIdentificationKey && newKeys.identification && result.oldIdentificationKey !== newKeys.identification ? this.storage.delete(result.oldIdentificationKey) : Promise.resolve(), result.oldPropertyKey && newKeys.property && result.oldPropertyKey !== newKeys.property ? this.storage.delete(result.oldPropertyKey) : Promise.resolve()]); return detailOutput(result.aggregate);
    } catch (error) { await Promise.allSettled(files.map((key) => this.storage.delete(key))); throw error; }
  }
}
