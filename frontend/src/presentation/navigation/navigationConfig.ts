export type NavigationLink = {
  id: string;
  type: 'link';
  label: string;
  path: string;
  icon: NavigationIcon;
  requiredPermission?: string;
};

export type NavigationGroup = {
  id: string;
  type: 'group';
  label: string;
  icon: NavigationIcon;
  items: NavigationEntry[];
  requiredPermission?: string;
};

export type NavigationEntry = NavigationLink | NavigationGroup;

export type NavigationIcon =
  | 'administration'
  | 'dashboard'
  | 'users'
  | 'roles'
  | 'location'
  | 'payment'
  | 'route'
  | 'settings';

export type NavigationPermissionChecker = (permission: string) => boolean;

export function filterNavigationEntries(
  entries: NavigationEntry[],
  can: NavigationPermissionChecker,
): NavigationEntry[] {
  return entries
    .map((entry) => entry.type === 'group'
      ? { ...entry, items: filterNavigationEntries(entry.items, can) }
      : entry)
    .filter((entry) => {
      if (entry.requiredPermission && !can(entry.requiredPermission)) return false;
      return entry.type === 'link' || entry.items.length > 0;
    });
}

export function isNavigationEntryActive(entry: NavigationEntry, pathname: string): boolean {
  return entry.type === 'link'
    ? pathname === entry.path || pathname.startsWith(`${entry.path}/`)
    : entry.items.some((item) => isNavigationEntryActive(item, pathname));
}

export function getActiveGroupIds(entries: NavigationEntry[], pathname: string): string[] {
  return entries.flatMap((entry) => {
    if (entry.type !== 'group' || !isNavigationEntryActive(entry, pathname)) return [];
    return [entry.id, ...getActiveGroupIds(entry.items, pathname)];
  });
}

export function toggleExpandedGroup(groupIds: string[], groupId: string): string[] {
  return groupIds.includes(groupId)
    ? groupIds.filter((item) => item !== groupId)
    : [...groupIds, groupId];
}

export function toggleAccordionGroup(
  groupIds: string[],
  groupId: string,
  depth: number,
  activeGroupIds: string[] = [],
): string[] {
  if (depth > 0) return toggleExpandedGroup(groupIds, groupId);

  if (groupIds.includes(groupId)) {
    return groupIds.filter((item) => item !== groupId && !item.startsWith(`${groupId}.`));
  }

  return [
    groupId,
    ...activeGroupIds.filter((item) => item !== groupId && item.startsWith(`${groupId}.`)),
  ];
}

export const navigationEntries: NavigationEntry[] = [
  {
    id: 'dashboard',
    type: 'link',
    label: 'Inicio',
    path: '/dashboard',
    icon: 'dashboard',
  },
  {
    id: 'administration',
    type: 'group',
    label: 'Administración',
    icon: 'administration',
    items: [
       { id: 'administration.users', type: 'link', label: 'Usuarios', path: '/users', icon: 'users', requiredPermission: 'users.view' },
       { id: 'administration.roles', type: 'link', label: 'Roles y permisos', path: '/roles', icon: 'roles', requiredPermission: 'roles.view' },
    ],
  },
  {
    id: 'customers',
    type: 'group',
    label: 'Clientes',
    icon: 'users',
    items: [
       { id: 'customers.list', type: 'link', label: 'Clientes', path: '/customers', icon: 'users', requiredPermission: 'customers.view' },
       { id: 'customers.new', type: 'link', label: 'Nuevo cliente', path: '/customers/new', icon: 'users', requiredPermission: 'customers.create' },
       { id: 'customers.financial-analysis', type: 'link', label: 'Análisis financiero', path: '/customers/financial-analysis', icon: 'users', requiredPermission: 'customers.analysis.view' },
       { id: 'customers.statistics', type: 'link', label: 'Estadísticas de clientes', path: '/customers/statistics', icon: 'users', requiredPermission: 'customers.statistics.view' },
       { id: 'customers.assigned', type: 'link', label: 'Clientes asignados', path: '/collector/customers', icon: 'route', requiredPermission: 'customers.assigned.view' },
    ],
  },
  {
    id: 'collector',
    type: 'group',
    label: 'Cobrador',
    icon: 'users',
    items: [
       { id: 'collector.collectors', type: 'link', label: 'Cobradores', path: '/collectors', icon: 'users', requiredPermission: 'collectors.view' },
    ],
  },
  {
      id: 'settings',
      type: 'group',
      label: 'Configuración',
      icon: 'settings',
      items: [
       {
         id: 'settings.territorial',
         type: 'group',
         label: 'División territorial',
         icon: 'location',
         requiredPermission: 'territorial.view',
         items: [
           { id: 'settings.territorial.provinces', type: 'link', label: 'Provincias', path: '/settings/provinces', icon: 'location', requiredPermission: 'territorial.view' },
           { id: 'settings.territorial.cantons', type: 'link', label: 'Cantones', path: '/settings/cantons', icon: 'location', requiredPermission: 'territorial.view' },
           { id: 'settings.territorial.districts', type: 'link', label: 'Distritos', path: '/settings/districts', icon: 'location', requiredPermission: 'territorial.view' },
         ],
       },
       { id: 'settings.payment-methods', type: 'link', label: 'Formas de pago', path: '/settings/payment-methods', icon: 'payment', requiredPermission: 'payment-methods.view' },
       { id: 'settings.payment-frequencies', type: 'link', label: 'Periodicidades de pago', path: '/settings/payment-frequencies', icon: 'payment', requiredPermission: 'payment-frequencies.view' },
       { id: 'settings.routes', type: 'link', label: 'Rutas', path: '/settings/routes', icon: 'route', requiredPermission: 'routes.view' },
        { id: 'settings.financial-opening', type: 'link', label: 'Cartera inicial', path: '/settings/financial-opening', icon: 'payment', requiredPermission: 'financial-opening.view' },
    ],
  },
  { id: 'finance', type: 'group', label: 'Finanzas', icon: 'payment', items: [{ id: 'finance.cash-movements', type: 'link', label: 'Movimientos de caja', path: '/finance/cash-movements', icon: 'payment', requiredPermission: 'cash-movements.view' }] },
  { id: 'loans', type: 'group', label: 'PRÉSTAMOS', icon: 'payment', items: [{ id: 'loans.list', type: 'link', label: 'Préstamos', path: '/loans', icon: 'payment', requiredPermission: 'loans.view' }, { id: 'loans.cancelled', type: 'link', label: 'Préstamos cancelados', path: '/loans/cancelled', icon: 'payment', requiredPermission: 'loans.view' }, { id: 'loans.uncollectible', type: 'link', label: 'Préstamos incobrables', path: '/loans/uncollectible-management', icon: 'payment', requiredPermission: 'loans.view' }, { id: 'loans.new', type: 'link', label: 'Nuevo préstamo', path: '/loans/new', icon: 'payment', requiredPermission: 'loans.create' }] },
  { id: 'payments', type: 'group', label: 'PAGOS', icon: 'payment', items: [{ id: 'payments.new', type: 'link', label: 'Registrar pago', path: '/payments/new', icon: 'payment', requiredPermission: 'payments.view' }] },
];
