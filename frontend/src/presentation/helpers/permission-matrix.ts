import type { PermissionRecord } from '../../application/ports/security.repository';

export type PermissionGroup = {
  module: string;
  label: string;
  permissions: PermissionRecord[];
};

export const MODULE_LABELS: Record<string, string> = {
  Usuarios: 'Usuarios',
  Seguridad: 'Roles y permisos',
  Clientes: 'Clientes',
  COBRADORES: 'Cobradores',
  Rutas: 'Rutas',
  'Métodos de pago': 'Métodos de pago',
  'Frecuencias de pago': 'Frecuencias de pago',
  Territorial: 'Territorial',
};

const MODULE_ORDER = [
  'Usuarios',
  'Seguridad',
  'Clientes',
  'COBRADORES',
  'Rutas',
  'Métodos de pago',
  'Frecuencias de pago',
  'Territorial',
];

function compareModules(left: string, right: string): number {
  const leftIndex = MODULE_ORDER.indexOf(left);
  const rightIndex = MODULE_ORDER.indexOf(right);
  if (leftIndex !== -1 && rightIndex !== -1) return leftIndex - rightIndex;
  if (leftIndex !== -1) return -1;
  if (rightIndex !== -1) return 1;
  return 0;
}

export function moduleLabel(module: string): string {
  return MODULE_LABELS[module] ?? module;
}

export function buildPermissionGroups(permissions: PermissionRecord[]): PermissionGroup[] {
  const groups = new Map<string, PermissionRecord[]>();
  for (const permission of permissions) {
    const values = groups.get(permission.module) ?? [];
    values.push(permission);
    groups.set(permission.module, values);
  }
  return [...groups.entries()]
    .sort(([left], [right]) => compareModules(left, right))
    .map(([module, values]) => ({ module, label: moduleLabel(module), permissions: values }));
}

export function filterPermissionGroups(groups: PermissionGroup[], query: string): PermissionGroup[] {
  const normalizedQuery = query.trim().toLocaleLowerCase();
  if (!normalizedQuery) return groups;
  return groups
    .map((group) => ({
      ...group,
      permissions: group.permissions.filter((permission) =>
        [group.label, permission.name, permission.code]
          .some((value) => value.toLocaleLowerCase().includes(normalizedQuery)),
      ),
    }))
    .filter((group) => group.permissions.length > 0);
}

export function togglePermission(codes: string[], code: string): string[] {
  return codes.includes(code) ? codes.filter((item) => item !== code) : [...codes, code];
}

export function toggleModule(openModules: string[], module: string): string[] {
  return openModules.includes(module)
    ? openModules.filter((item) => item !== module)
    : [...openModules, module];
}

export function setModulePermissions(codes: string[], group: PermissionGroup, selected: boolean): string[] {
  const moduleCodes = new Set(group.permissions.map((permission) => permission.code));
  const withoutModule = codes.filter((code) => !moduleCodes.has(code));
  return selected ? [...withoutModule, ...moduleCodes] : withoutModule;
}

export function permissionSetsEqual(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const rightCodes = new Set(right);
  return left.every((code) => rightCodes.has(code));
}

export function canSavePermissions(input: {
  dirty: boolean;
  isSuperAdmin: boolean;
  authorized: boolean;
  loading: boolean;
  saving: boolean;
}): boolean {
  return input.dirty && !input.isSuperAdmin && input.authorized && !input.loading && !input.saving;
}

export function shouldConfirmRoleSwitch(dirty: boolean, currentRoleId: string, nextRoleId: string): boolean {
  return dirty && currentRoleId !== nextRoleId;
}
