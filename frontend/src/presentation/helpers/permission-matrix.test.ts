import { describe, expect, it } from 'vitest';
import type { PermissionRecord } from '../../application/ports/security.repository';
import {
  buildPermissionGroups,
  canSavePermissions,
  filterPermissionGroups,
  permissionSetsEqual,
  setModulePermissions,
  shouldConfirmRoleSwitch,
  toggleModule,
  togglePermission,
} from './permission-matrix';

const permission = (module: string, code: string, name = code): PermissionRecord => ({ id: code, module, code, name });

describe('permission matrix helpers', () => {
  const records = [
    permission('unknown', 'unknown.view', 'Unknown'),
    permission('Territorial', 'territorial.view'),
    permission('Frecuencias de pago', 'payment-frequencies.view'),
    permission('Métodos de pago', 'payment-methods.view'),
    permission('Rutas', 'routes.view', 'Consultar rutas'),
    permission('COBRADORES', 'collectors.view'),
    permission('Clientes', 'customers.view', 'Consultar clientes'),
    permission('Rutas', 'routes.create', 'Crear rutas'),
    permission('Seguridad', 'roles.view'),
    permission('Usuarios', 'users.view'),
  ];

  it('groups by module in stable logical order and keeps unknown modules visible last', () => {
    expect(buildPermissionGroups(records).map((group) => group.module)).toEqual([
      'Usuarios',
      'Seguridad',
      'Clientes',
      'COBRADORES',
      'Rutas',
      'Métodos de pago',
      'Frecuencias de pago',
      'Territorial',
      'unknown',
    ]);
    expect(buildPermissionGroups(records).find((group) => group.module === 'Seguridad')?.label).toBe('Roles y permisos');
    expect(buildPermissionGroups(records).find((group) => group.module === 'COBRADORES')?.label).toBe('Cobradores');
  });

  it('supports collapsed-by-default accordion state through explicit open ids', () => {
    expect(toggleModule([], 'Clientes')).toEqual(['Clientes']);
    expect(toggleModule(['Clientes'], 'Clientes')).toEqual([]);
    expect(toggleModule(['Clientes'], 'Rutas')).toEqual(['Clientes', 'Rutas']);
  });

  it('updates selected totals and module selection without affecting another module', () => {
    const groups = buildPermissionGroups(records);
    const routes = groups.find((group) => group.module === 'Rutas')!;
    expect(routes.permissions).toHaveLength(2);
    expect(setModulePermissions(['customers.view'], routes, true)).toEqual(['customers.view', 'routes.view', 'routes.create']);
    expect(setModulePermissions(['customers.view', 'routes.view'], routes, false)).toEqual(['customers.view']);
    expect(togglePermission(['customers.view'], 'customers.view')).toEqual([]);
  });

  it('filters by module label, display name, or code and preserves draft independently', () => {
    const groups = buildPermissionGroups(records);
    const draft = ['customers.view', 'routes.view'];
    expect(filterPermissionGroups(groups, 'clientes')[0].permissions[0].code).toBe('customers.view');
    expect(filterPermissionGroups(groups, 'routes.create')[0].permissions[0].code).toBe('routes.create');
    expect(filterPermissionGroups(groups, 'missing')).toEqual([]);
    expect(draft).toEqual(['customers.view', 'routes.view']);
  });

  it('computes dirty state and save eligibility', () => {
    expect(permissionSetsEqual(['a', 'b'], ['b', 'a'])).toBe(true);
    expect(permissionSetsEqual(['a'], ['b'])).toBe(false);
    expect(canSavePermissions({ dirty: true, isSuperAdmin: false, authorized: true, loading: false, saving: false })).toBe(true);
    expect(canSavePermissions({ dirty: false, isSuperAdmin: false, authorized: true, loading: false, saving: false })).toBe(false);
    expect(canSavePermissions({ dirty: true, isSuperAdmin: true, authorized: true, loading: false, saving: false })).toBe(false);
  });

  it('requires a decision before switching roles with unsaved changes', () => {
    expect(shouldConfirmRoleSwitch(true, 'one', 'two')).toBe(true);
    expect(shouldConfirmRoleSwitch(true, 'one', 'one')).toBe(false);
    expect(shouldConfirmRoleSwitch(false, 'one', 'two')).toBe(false);
  });

  it('identifies superadmin behavior without making the matrix editable', () => {
    expect(canSavePermissions({ dirty: true, isSuperAdmin: true, authorized: true, loading: false, saving: false })).toBe(false);
  });
});
