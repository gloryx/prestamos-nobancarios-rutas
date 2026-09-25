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
  items: NavigationLink[];
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
       { type: 'link', label: 'Provincias', path: '/settings/provinces', icon: 'location', requiredPermission: 'territorial.view' },
       { type: 'link', label: 'Cantones', path: '/settings/cantons', icon: 'location', requiredPermission: 'territorial.view' },
       { type: 'link', label: 'Distritos', path: '/settings/districts', icon: 'location', requiredPermission: 'territorial.view' },
       { type: 'link', label: 'Formas de pago', path: '/settings/payment-methods', icon: 'payment', requiredPermission: 'payment-methods.view' },
       { type: 'link', label: 'Periodicidades de pago', path: '/settings/payment-frequencies', icon: 'payment', requiredPermission: 'payment-frequencies.view' },
       { type: 'link', label: 'Rutas', path: '/settings/routes', icon: 'route', requiredPermission: 'routes.view' },
    ],
  },
];
