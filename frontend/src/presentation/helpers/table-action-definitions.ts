import type { TableAction } from '../components/TableActions';

export type ActionPermission = (code: string) => boolean;
export type ActionSetPermission = (codes: string[]) => boolean;

type Definition = TableAction & { permission?: string; allPermissions?: string[] };

export function visibleTableActions(definitions: Definition[], can: ActionPermission, canAll: ActionSetPermission = (codes) => codes.every(can)): TableAction[] {
  return definitions.filter((definition) => (!definition.permission || can(definition.permission)) && (!definition.allPermissions || canAll(definition.allPermissions))).map((definition) => {
    const action = { ...definition };
    delete action.permission;
    delete action.allPermissions;
    return action;
  });
}

export function customerActionDefinitions(isActive: boolean): Definition[] {
  return [
    { key: 'view', icon: 'view', label: 'Ver información', title: 'Ver información', ariaLabel: 'Ver información', permission: 'customers.view' },
    { key: 'edit', icon: 'edit', label: 'Editar cliente', title: 'Editar cliente', ariaLabel: 'Editar cliente', permission: 'customers.update' },
    { key: 'payment', icon: 'payment', label: 'Disponible próximamente', title: 'Disponible próximamente', ariaLabel: 'Disponible próximamente', disabled: true },
    { key: 'download', icon: 'download', label: 'Descargar expediente', title: 'Descargar expediente', ariaLabel: 'Descargar expediente', allPermissions: ['customers.export', 'customers.files.view'] },
    { key: 'status', icon: isActive ? 'lock' : 'unlock', label: isActive ? 'Inactivar cliente' : 'Activar cliente', title: isActive ? 'Inactivar cliente' : 'Activar cliente', ariaLabel: isActive ? 'Inactivar cliente' : 'Activar cliente', permission: 'customers.status.change' },
  ];
}

export function userActionDefinitions(isActive: boolean): Definition[] {
  return [
    { key: 'edit', icon: 'edit', label: 'Editar usuario', title: 'Editar usuario', ariaLabel: 'Editar usuario', permission: 'users.update' },
    { key: 'role', icon: 'roles', label: 'Cambiar rol', title: 'Cambiar rol', ariaLabel: 'Cambiar rol', permission: 'users.role.assign' },
    { key: 'password', icon: 'key', label: 'Restablecer contraseña', title: 'Restablecer contraseña', ariaLabel: 'Restablecer contraseña', permission: 'users.password.reset' },
    { key: 'status', icon: isActive ? 'lock' : 'unlock', label: isActive ? 'Inactivar usuario' : 'Activar usuario', title: isActive ? 'Inactivar usuario' : 'Activar usuario', ariaLabel: isActive ? 'Inactivar usuario' : 'Activar usuario', permission: 'users.status.change' },
  ];
}

export function collectorActionDefinitions(isActive: boolean, hasPhoto: boolean, hasUser: boolean): Definition[] {
  return [
    ...(hasPhoto ? [{ key: 'photo', icon: 'photo' as const, label: 'Ver fotografía', title: 'Ver fotografía', ariaLabel: 'Ver fotografía', permission: 'collectors.photo.view' }] : []),
    { key: 'edit', icon: 'edit', label: 'Editar cobrador', title: 'Editar cobrador', ariaLabel: 'Editar cobrador', permission: 'collectors.update' },
    { key: 'user', icon: 'user-link', label: hasUser ? 'Cambiar usuario' : 'Vincular usuario', title: hasUser ? 'Cambiar usuario' : 'Vincular usuario', ariaLabel: hasUser ? 'Cambiar usuario' : 'Vincular usuario', permission: 'collectors.user.assign' },
    { key: 'status', icon: isActive ? 'lock' : 'unlock', label: isActive ? 'Inactivar cobrador' : 'Activar cobrador', title: isActive ? 'Inactivar cobrador' : 'Activar cobrador', ariaLabel: isActive ? 'Inactivar cobrador' : 'Activar cobrador', permission: 'collectors.status.change' },
  ];
}
