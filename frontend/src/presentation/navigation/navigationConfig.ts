export type NavigationLink = {
  type: 'link';
  label: string;
  path: string;
  icon: NavigationIcon;
  requiredPermission?: string;
};

export type NavigationGroup = {
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

export function getActiveGroupLabels(entries: NavigationEntry[], pathname: string): string[] {
  return entries.flatMap((entry) => {
    if (entry.type !== 'group' || !isNavigationEntryActive(entry, pathname)) return [];
    return [entry.label, ...getActiveGroupLabels(entry.items, pathname)];
  });
}

export function toggleExpandedGroup(labels: string[], label: string): string[] {
  return labels.includes(label) ? labels.filter((item) => item !== label) : [...labels, label];
}

export const navigationEntries: NavigationEntry[] = [
  {
    type: 'link',
    label: 'Inicio',
    path: '/dashboard',
    icon: 'dashboard',
  },
  {
    type: 'group',
    label: 'Administración',
    icon: 'administration',
    items: [
       { type: 'link', label: 'Usuarios', path: '/users', icon: 'users', requiredPermission: 'users.view' },
       { type: 'link', label: 'Roles y permisos', path: '/roles', icon: 'roles', requiredPermission: 'roles.view' },
    ],
  },
  {
    type: 'group',
    label: 'Clientes',
    icon: 'users',
    items: [
       { type: 'link', label: 'Clientes', path: '/customers', icon: 'users', requiredPermission: 'customers.view' },
       { type: 'link', label: 'Nuevo cliente', path: '/customers/new', icon: 'users', requiredPermission: 'customers.create' },
       { type: 'link', label: 'Análisis financiero', path: '/customers/financial-analysis', icon: 'users', requiredPermission: 'customers.analysis.view' },
       { type: 'link', label: 'Estadísticas de clientes', path: '/customers/statistics', icon: 'users', requiredPermission: 'customers.statistics.view' },
       { type: 'link', label: 'Clientes asignados', path: '/collector/customers', icon: 'route', requiredPermission: 'customers.assigned.view' },
    ],
  },
  {
    type: 'group',
    label: 'Cobrador',
    icon: 'users',
    items: [
       { type: 'link', label: 'Cobradores', path: '/collectors', icon: 'users', requiredPermission: 'collectors.view' },
    ],
  },
  {
      type: 'group',
      label: 'Configuración',
      icon: 'settings',
      items: [
       {
         type: 'group',
         label: 'División territorial',
         icon: 'location',
         requiredPermission: 'territorial.view',
         items: [
           { type: 'link', label: 'Provincias', path: '/settings/provinces', icon: 'location', requiredPermission: 'territorial.view' },
           { type: 'link', label: 'Cantones', path: '/settings/cantons', icon: 'location', requiredPermission: 'territorial.view' },
           { type: 'link', label: 'Distritos', path: '/settings/districts', icon: 'location', requiredPermission: 'territorial.view' },
         ],
       },
       { type: 'link', label: 'Formas de pago', path: '/settings/payment-methods', icon: 'payment', requiredPermission: 'payment-methods.view' },
       { type: 'link', label: 'Periodicidades de pago', path: '/settings/payment-frequencies', icon: 'payment', requiredPermission: 'payment-frequencies.view' },
       { type: 'link', label: 'Rutas', path: '/settings/routes', icon: 'route', requiredPermission: 'routes.view' },
        { type: 'link', label: 'Cartera inicial', path: '/settings/financial-opening', icon: 'payment', requiredPermission: 'financial-opening.view' },
    ],
  },
  { type: 'group', label: 'Finanzas', icon: 'payment', items: [{ type: 'link', label: 'Movimientos de caja', path: '/finance/cash-movements', icon: 'payment', requiredPermission: 'cash-movements.view' }] },
  { type: 'group', label: 'PRÉSTAMOS', icon: 'payment', items: [{ type: 'link', label: 'Préstamos', path: '/loans', icon: 'payment', requiredPermission: 'loans.view' }, { type: 'link', label: 'Nuevo préstamo', path: '/loans/new', icon: 'payment', requiredPermission: 'loans.create' }] },
  { type: 'group', label: 'PAGOS', icon: 'payment', items: [{ type: 'link', label: 'Pagos', path: '/payments', icon: 'payment', requiredPermission: 'payments.view' }] },
];
