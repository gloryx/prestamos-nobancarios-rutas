export const PERMISSIONS = [
  ['territorial.view', 'Consultar territorial', 'Territorial'],
  ['payment-methods.view', 'Consultar métodos de pago', 'Métodos de pago'], ['payment-methods.create', 'Crear métodos de pago', 'Métodos de pago'], ['payment-methods.update', 'Editar métodos de pago', 'Métodos de pago'], ['payment-methods.status.change', 'Cambiar estado de métodos de pago', 'Métodos de pago'], ['payment-methods.export', 'Exportar métodos de pago', 'Métodos de pago'],
  ['payment-frequencies.view', 'Consultar frecuencias de pago', 'Frecuencias de pago'], ['payment-frequencies.create', 'Crear frecuencias de pago', 'Frecuencias de pago'], ['payment-frequencies.update', 'Editar frecuencias de pago', 'Frecuencias de pago'], ['payment-frequencies.status.change', 'Cambiar estado de frecuencias de pago', 'Frecuencias de pago'], ['payment-frequencies.export', 'Exportar frecuencias de pago', 'Frecuencias de pago'],
  ['routes.view', 'Consultar rutas', 'Rutas'], ['routes.create', 'Crear rutas', 'Rutas'], ['routes.update', 'Editar rutas', 'Rutas'], ['routes.status.change', 'Cambiar estado de rutas', 'Rutas'], ['routes.export', 'Exportar rutas', 'Rutas'],
  ['customers.view', 'Consultar clientes', 'Clientes'], ['customers.create', 'Crear clientes', 'Clientes'], ['customers.update', 'Editar clientes', 'Clientes'], ['customers.status.change', 'Cambiar estado de clientes', 'Clientes'], ['customers.summary.view', 'Consultar resumen de clientes', 'Clientes'], ['customers.files.view', 'Consultar archivos de clientes', 'Clientes'], ['customers.export', 'Exportar clientes', 'Clientes'],
  ['users.view', 'Consultar usuarios', 'Usuarios'], ['users.create', 'Crear usuarios', 'Usuarios'], ['users.update', 'Editar usuarios', 'Usuarios'], ['users.status.change', 'Cambiar estado de usuarios', 'Usuarios'], ['users.password.reset', 'Restablecer contraseñas', 'Usuarios'], ['users.role.assign', 'Asignar roles', 'Usuarios'],
  ['roles.view', 'Consultar roles y permisos', 'Seguridad'], ['roles.permissions.update', 'Editar permisos de roles', 'Seguridad'],
] as const;
export const COLLECTION_MANAGER_DEFAULTS = [
  'territorial.view',
  'customers.view',
  'customers.create',
  'customers.update',
  'customers.status.change',
  'customers.export',
  'customers.files.view',
  'routes.view',
  'routes.create',
  'routes.update',
  'routes.status.change',
  'routes.export',
] as const;
export const SESSION_COOKIE = 'pnb_session';
export const invalidCredentialsMessage = 'Usuario o contraseña inválidos.';
