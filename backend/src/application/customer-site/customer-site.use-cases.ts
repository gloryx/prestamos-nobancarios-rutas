import { randomUUID } from 'node:crypto';
import type { CurrentIdentity } from '../../domain/security/security.types';
import type { SiteUpdateScope } from '../../domain/customer-site/customer-site.types';
import { CustomerSiteBadRequestError, CustomerSiteForbiddenError, CustomerSiteNotFoundError } from '../../domain/customer-site/customer-site.errors';
import type { CustomerSiteRepository } from './customer-site.repository';
import type { FileStorage, UploadFile } from '../customer/file-storage';

const scopes: readonly SiteUpdateScope[] = ['LOCATION', 'PHOTO', 'LOCATION_AND_PHOTO'];
const image = (file: UploadFile): void => {
  if (file.size > 5 * 1024 * 1024) throw new CustomerSiteBadRequestError('La foto del inmueble no puede superar 5 MB.');
  const b = file.buffer;
  const valid = (b.length > 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) || (b.length > 8 && b.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) || (b.length > 12 && b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP');
  if (!valid || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype ?? '')) throw new CustomerSiteBadRequestError('La foto del inmueble debe ser JPEG, PNG o WEBP válido.');
};
const scoped = (actor: CurrentIdentity): boolean => !actor.role.isSuperAdmin && !actor.permissions.includes('customers.view');
const can = (actor: CurrentIdentity, permission: string): boolean => actor.role.isSuperAdmin || actor.permissions.includes(permission);
const normalizedReason = (reason: string): string => reason.trim().replace(/\s+/g, ' ').toUpperCase();

export class CustomerSiteUseCases {
  constructor(private readonly repository: CustomerSiteRepository, private readonly storage: FileStorage) {}

  async assignedCustomers(actor: CurrentIdentity) {
    if (!can(actor, 'customers.assigned.view')) throw new CustomerSiteForbiddenError('No tiene permiso para consultar clientes asignados.');
    if (!actor.role.isSuperAdmin && !actor.permissions.includes('customers.assigned.view')) throw new CustomerSiteForbiddenError('No tiene permiso para consultar clientes asignados.');
    return this.repository.listAssignedCustomers(actor.id);
  }

  async assignedCollectors(customerId: string, actor: CurrentIdentity) {
    if (!can(actor, 'customers.site.replace.authorize')) throw new CustomerSiteForbiddenError('No tiene permiso para consultar cobradores asignados.');
    return this.repository.listAssignedCollectors(customerId);
  }

  async routeAssignmentOptions(actor: CurrentIdentity) {
    if (!can(actor, 'routes.assign.customers') && !can(actor, 'routes.assign.collectors')) throw new CustomerSiteForbiddenError('No tiene permiso para consultar opciones de asignación.');
    return this.repository.listRouteAssignmentOptions();
  }

  async hasAccess(customerId: string, actor: CurrentIdentity): Promise<void> {
    if (!scoped(actor)) return;
    if (!(await this.repository.hasCollectorAccess(customerId, actor.id))) throw new CustomerSiteForbiddenError('El cliente no está asignado al usuario activo.');
  }

  async assignCustomer(customerId: string, routeId: string, actor: CurrentIdentity) {
    if (!can(actor, 'routes.assign.customers')) throw new CustomerSiteForbiddenError('No tiene permiso para asignar clientes.');
    return this.repository.createCustomerAssignment({ customerId, routeId, assignedByUserId: actor.id });
  }
  async assignCollector(routeId: string, collectorUserId: string, actor: CurrentIdentity) {
    if (!can(actor, 'routes.assign.collectors')) throw new CustomerSiteForbiddenError('No tiene permiso para asignar cobradores.');
    return this.repository.createCollectorAssignment({ routeId, collectorUserId, assignedByUserId: actor.id });
  }
  endCustomerAssignment(id: string, actor: CurrentIdentity) { if (!can(actor, 'routes.assign.customers')) throw new CustomerSiteForbiddenError('No tiene permiso para finalizar asignaciones.'); return this.repository.endCustomerAssignment(id, new Date()); }
  endCollectorAssignment(id: string, actor: CurrentIdentity) { if (!can(actor, 'routes.assign.collectors')) throw new CustomerSiteForbiddenError('No tiene permiso para finalizar asignaciones.'); return this.repository.endCollectorAssignment(id, new Date()); }

  async authorize(customerId: string, input: { collectorUserId: string; scope: string; reason: string; expiresAt: string }, actor: CurrentIdentity) {
    if (!can(actor, 'customers.site.replace.authorize')) throw new CustomerSiteForbiddenError('No tiene permiso para autorizar reemplazos.');
    const scope = input.scope as SiteUpdateScope;
    const reason = normalizedReason(input.reason ?? '');
    const expiresAt = new Date(input.expiresAt);
    if (!scopes.includes(scope) || !reason || Number.isNaN(expiresAt.valueOf()) || expiresAt <= new Date()) throw new CustomerSiteBadRequestError('La autorización no es válida.');
    await this.repository.validateAuthorizationTarget(customerId, input.collectorUserId);
    return this.repository.createAuthorization({ customerId, collectorUserId: input.collectorUserId, scope, reason, authorizedByUserId: actor.id, authorizedAt: new Date(), expiresAt });
  }
  list(customerId: string, actor: CurrentIdentity) { if (!can(actor, 'customers.site.replace.authorize')) throw new CustomerSiteForbiddenError('No tiene permiso para consultar autorizaciones.'); return this.repository.listAuthorizations(customerId); }
  revoke(customerId: string, id: string, actor: CurrentIdentity) { if (!can(actor, 'customers.site.replace.authorize')) throw new CustomerSiteForbiddenError('No tiene permiso para revocar autorizaciones.'); return this.repository.revokeAuthorization(id, customerId); }

  async site(customerId: string, actor: CurrentIdentity) {
    await this.hasAccess(customerId, actor);
    const site = await this.repository.readSite(customerId, scoped(actor) ? actor.id : undefined);
    if (!site) throw new CustomerSiteNotFoundError('Cliente activo no encontrado.');
    return site;
  }

  async update(customerId: string, input: { latitude?: number | null; longitude?: number | null; propertyPhoto?: UploadFile }, actor: CurrentIdentity) {
    if (input.latitude === null || input.longitude === null) throw new CustomerSiteBadRequestError('No se permite eliminar la ubicación existente.');
    const location = input.latitude !== undefined || input.longitude !== undefined;
    const photo = Boolean(input.propertyPhoto);
    if (!location && !photo) throw new CustomerSiteBadRequestError('Debe enviar ubicación o foto.');
    if (location && (input.latitude === undefined || input.longitude === undefined || !Number.isFinite(input.latitude) || !Number.isFinite(input.longitude) || input.latitude < -90 || input.latitude > 90 || input.longitude < -180 || input.longitude > 180)) throw new CustomerSiteBadRequestError('Las coordenadas deben enviarse juntas y ser válidas.');
    if (input.propertyPhoto) image(input.propertyPhoto);
    await this.hasAccess(customerId, actor);
    if (!can(actor, 'customers.site.capture') && !can(actor, 'customers.site.replace')) throw new CustomerSiteForbiddenError('No tiene permiso para actualizar datos del sitio.');
    const current = await this.repository.readSite(customerId);
    if (!current) throw new CustomerSiteNotFoundError('Cliente activo no encontrado.');
    const existingLocation = current.latitude !== null || current.longitude !== null;
    const existingPhoto = current.hasPropertyPhoto;
    const replacingLocation = location && existingLocation;
    const replacingPhoto = photo && existingPhoto;
    const replacing = replacingLocation || replacingPhoto;
    if (!replacing && !can(actor, 'customers.site.capture')) throw new CustomerSiteForbiddenError('No tiene permiso para registrar datos faltantes.');
    if (replacing && !can(actor, 'customers.site.replace')) throw new CustomerSiteForbiddenError('No tiene permiso para reemplazar datos del sitio.');
    const authorizationScopes: SiteUpdateScope[] = replacingLocation && replacingPhoto ? ['LOCATION_AND_PHOTO'] : replacingLocation ? ['LOCATION', 'LOCATION_AND_PHOTO'] : ['PHOTO', 'LOCATION_AND_PHOTO'];
    const key = input.propertyPhoto ? `clientes/casas-negocios/site-${customerId}-${randomUUID()}.${input.propertyPhoto.mimetype === 'image/png' ? 'png' : input.propertyPhoto.mimetype === 'image/webp' ? 'webp' : 'jpg'}` : undefined;
    if (key) await this.storage.save(input.propertyPhoto!, key);
    try {
      const result = await this.repository.updateSiteAtomically(customerId, { latitude: input.latitude ?? undefined, longitude: input.longitude ?? undefined, propertyPhotoFileKey: key }, actor.id, replacing && scoped(actor) ? authorizationScopes : [], new Date());
      if (result.oldPropertyPhotoKey && key && result.oldPropertyPhotoKey !== key) await this.storage.delete(result.oldPropertyPhotoKey);
      return this.repository.readSite(customerId);
    } catch (error) {
      if (key) await Promise.allSettled([this.storage.delete(key)]);
      throw error;
    }
  }
}
