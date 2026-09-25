import { describe, expect, it } from 'vitest';
import { collectorActionDefinitions, customerActionDefinitions, userActionDefinitions, visibleTableActions } from './table-action-definitions';

const allowAll = () => true;

describe('table action definitions', () => {
  it('preserves the Customer order, disabled future payment, and status convention', () => {
    const active = visibleTableActions(customerActionDefinitions(true), allowAll);
    expect(active.map((action) => action.key)).toEqual(['view', 'edit', 'payment', 'download', 'status']);
    expect(active[2]).toMatchObject({ icon: 'payment', label: 'Disponible próximamente', disabled: true, title: 'Disponible próximamente', ariaLabel: 'Disponible próximamente' });
    expect(active[4]).toMatchObject({ icon: 'lock', label: 'Inactivar cliente', title: 'Inactivar cliente', ariaLabel: 'Inactivar cliente' });
    expect(visibleTableActions(customerActionDefinitions(false), allowAll)[4]).toMatchObject({ icon: 'unlock', label: 'Activar cliente' });
  });

  it('defines authorized Users actions in the requested order with accessible labels', () => {
    const actions = visibleTableActions(userActionDefinitions(true), allowAll);
    expect(actions.map((action) => [action.icon, action.label, action.title, action.ariaLabel])).toEqual([
      ['edit', 'Editar usuario', 'Editar usuario', 'Editar usuario'],
      ['roles', 'Cambiar rol', 'Cambiar rol', 'Cambiar rol'],
      ['key', 'Restablecer contraseña', 'Restablecer contraseña', 'Restablecer contraseña'],
      ['lock', 'Inactivar usuario', 'Inactivar usuario', 'Inactivar usuario'],
    ]);
    expect(visibleTableActions(userActionDefinitions(false), allowAll)[3]).toMatchObject({ icon: 'unlock', label: 'Activar usuario' });
  });

  it('defines authorized Collector actions with conditional photo and linked-user labels', () => {
    const actions = visibleTableActions(collectorActionDefinitions(true, true, true), allowAll);
    expect(actions.map((action) => action.key)).toEqual(['photo', 'edit', 'user', 'status']);
    expect(actions.map((action) => [action.icon, action.label, action.title, action.ariaLabel])).toEqual([
      ['photo', 'Ver fotografía', 'Ver fotografía', 'Ver fotografía'],
      ['edit', 'Editar cobrador', 'Editar cobrador', 'Editar cobrador'],
      ['user-link', 'Cambiar usuario', 'Cambiar usuario', 'Cambiar usuario'],
      ['lock', 'Inactivar cobrador', 'Inactivar cobrador', 'Inactivar cobrador'],
    ]);
    expect(visibleTableActions(collectorActionDefinitions(false, false, false), allowAll).map((action) => action.key)).toEqual(['edit', 'user', 'status']);
    expect(visibleTableActions(collectorActionDefinitions(false, false, false), allowAll)[1]).toMatchObject({ label: 'Vincular usuario' });
    expect(visibleTableActions(collectorActionDefinitions(false, false, false), allowAll)[2]).toMatchObject({ icon: 'unlock', label: 'Activar cobrador' });
  });

  it('hides unauthorized actions while preserving actions supplied by the centralized can helper', () => {
    const can = (permission: string) => permission === 'users.update' || permission === 'users.status.change';
    expect(visibleTableActions(userActionDefinitions(true), can).map((action) => action.key)).toEqual(['edit', 'status']);

    const superadminCan = () => true;
    expect(visibleTableActions(userActionDefinitions(true), superadminCan).map((action) => action.key)).toEqual(['edit', 'role', 'password', 'status']);
  });

  it('requires both Customer permissions for the expediente action', () => {
    const can = () => false;
    const canAll = (permissions: string[]) => permissions.includes('customers.export') && permissions.includes('customers.files.view');
    expect(visibleTableActions(customerActionDefinitions(true), can, canAll).map((action) => action.key)).toEqual(['payment', 'download']);
  });
});
