import { describe, expect, it } from 'vitest';
import { collectorActionDefinitions, customerActionDefinitions, customerFinancialAnalysisPath, userActionDefinitions, visibleTableActions } from './table-action-definitions';

const allowAll = () => true;

describe('table action definitions', () => {
  it('preserves the Customer order, loan action, and status convention', () => {
    const active = visibleTableActions(customerActionDefinitions(true), allowAll);
    expect(active.map((action) => action.key)).toEqual(['view', 'edit', 'analysis', 'loan', 'download', 'status']);
    expect(active[2]).toMatchObject({ icon: 'dashboard', label: 'Análisis financiero', ariaLabel: 'Consultar análisis financiero' });
    expect(active[3]).toMatchObject({ icon: 'hand-coins', label: 'Nuevo préstamo', disabled: false, title: 'Nuevo préstamo', ariaLabel: 'Otorgar nuevo préstamo' });
    expect(active[5]).toMatchObject({ icon: 'lock', label: 'Inactivar cliente', title: 'Inactivar cliente', ariaLabel: 'Inactivar cliente' });
    const inactive = visibleTableActions(customerActionDefinitions(false), allowAll);
    expect(inactive[3]).toMatchObject({ key: 'loan', disabled: true, title: 'El cliente debe estar activo' });
    expect(inactive[5]).toMatchObject({ icon: 'unlock', label: 'Activar cliente' });
    expect(customerFinancialAnalysisPath('customer/id')).toBe('/customers/customer%2Fid/financial-analysis');
    expect(customerFinancialAnalysisPath('customer/id', '2026-10-03'))
      .toBe('/customers/customer%2Fid/financial-analysis?asOf=2026-10-03');
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
    expect(visibleTableActions(customerActionDefinitions(true), can, canAll).map((action) => action.key)).toEqual(['download']);
  });

  it('publishes customer analysis only with its dedicated permission', () => {
    const onlyAnalysis = (permission: string) => permission === 'customers.analysis.view';
    expect(visibleTableActions(customerActionDefinitions(true), onlyAnalysis).map((action) => action.key)).toEqual(['analysis']);
  });

  it('publishes the customer loan action only with loans.create', () => {
    const onlyCreateLoan = (permission: string) => permission === 'loans.create';
    expect(visibleTableActions(customerActionDefinitions(true), onlyCreateLoan)).toEqual([
      expect.objectContaining({ key: 'loan', icon: 'hand-coins', disabled: false }),
    ]);
  });
});
