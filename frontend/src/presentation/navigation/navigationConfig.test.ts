import { describe, expect, it } from 'vitest';
import {
  filterNavigationEntries,
  getActiveGroupIds,
  isNavigationEntryActive,
  navigationEntries,
  collectorNavigationEntries,
  navigationEntriesFor,
  toggleAccordionGroup,
  toggleExpandedGroup,
} from './navigationConfig';

describe('sidebar navigation configuration', () => {
  const allowAll = () => true;

  it('publishes the requested top-level section order', () => {
    expect(navigationEntries.map((entry) => entry.id)).toEqual([
      'dashboard', 'loans', 'customers', 'collector', 'payments', 'finance', 'administration', 'settings',
    ]);
  });

  it('keeps territorial links under the nested División territorial group', () => {
    const settings = navigationEntries.find((entry) => entry.label === 'Configuración');

    expect(settings?.type).toBe('group');
    if (!settings || settings.type !== 'group') return;

    const territorial = settings.items.find((entry) => entry.label === 'División territorial');
    expect(territorial?.type).toBe('group');
    if (!territorial || territorial.type !== 'group') return;

    expect(territorial.items.map((entry) => entry.label)).toEqual(['Provincias', 'Cantones', 'Distritos']);
    expect(territorial.items.map((entry) => entry.type)).toEqual(['link', 'link', 'link']);
    expect(territorial.items.map((entry) => entry.type === 'link' && entry.path)).toEqual([
      '/settings/provinces',
      '/settings/cantons',
      '/settings/districts',
    ]);
    expect(territorial.requiredPermission).toBe('territorial.view');
    expect(territorial.items.every((entry) => entry.requiredPermission === 'territorial.view')).toBe(true);
  });

  it('preserves the other Configuración entries', () => {
    const settings = navigationEntries.find((entry) => entry.label === 'Configuración');

    expect(settings?.type).toBe('group');
    if (!settings || settings.type !== 'group') return;

    expect(settings.items.map((entry) => entry.label)).toEqual([
      'División territorial',
      'Formas de pago',
      'Periodicidades de pago',
      'Rutas',
      'Cartera inicial',
    ]);
  });

  it('hides the territorial group without territorial.view and keeps it with permission', () => {
    const withoutTerritorialAccess = filterNavigationEntries(navigationEntries, (permission) => permission !== 'territorial.view');
    const withTerritorialAccess = filterNavigationEntries(navigationEntries, allowAll);

    const hiddenSettings = withoutTerritorialAccess.find((entry) => entry.label === 'Configuración');
    const visibleSettings = withTerritorialAccess.find((entry) => entry.label === 'Configuración');

    expect(hiddenSettings?.type).toBe('group');
    if (hiddenSettings?.type === 'group') {
      expect(hiddenSettings.items.some((entry) => entry.label === 'División territorial')).toBe(false);
    }
    expect(visibleSettings?.type).toBe('group');
    if (visibleSettings?.type === 'group') {
      expect(visibleSettings.items.some((entry) => entry.label === 'División territorial')).toBe(true);
    }
  });

  it('links the PAGOS group directly to the permission-protected registration route', () => {
    const payments = navigationEntries.find((entry) => entry.label === 'PAGOS');

    expect(payments).toMatchObject({
      type: 'group',
      icon: 'payment',
      items: [{ type: 'link', label: 'Registrar pago', path: '/payments/new', icon: 'payment', requiredPermission: 'payments.view' },
        { type: 'link', label: 'Seguimiento de cartera', path: '/payments/portfolio-tracking', icon: 'payment', requiredPermission: 'payments.view' },
        { type: 'link', label: 'Cobros del día', path: '/payments/daily-collections', icon: 'payment', requiredPermission: 'payments.view' },
        { type: 'link', label: 'Historial de pagos', path: '/payments/history', icon: 'payment', requiredPermission: 'payments.view' }],
    });
    if (payments?.type !== 'group') return;
    expect(payments.items).toHaveLength(4);
    expect(getActiveGroupIds(navigationEntries, '/payments/new')).toEqual(['payments']);
    expect(getActiveGroupIds(navigationEntries, '/payments/portfolio-tracking')).toEqual(['payments']);
    expect(getActiveGroupIds(navigationEntries, '/payments/daily-collections')).toEqual(['payments']);
    expect(getActiveGroupIds(navigationEntries, '/payments/history')).toEqual(['payments']);
    expect(getActiveGroupIds(navigationEntries, '/payments/collector-report')).toEqual(['collector']);
  });

  it('filters registration by payments.view using the existing navigation helper', () => {
    const denied = filterNavigationEntries(navigationEntries, (permission) => permission !== 'payments.view');
    const allowed = filterNavigationEntries(navigationEntries, (permission) => permission === 'payments.view');

    expect(denied.some((entry) => entry.label === 'PAGOS')).toBe(false);
    expect(allowed.find((entry) => entry.label === 'PAGOS')).toMatchObject({
      type: 'group',
      items: [{ label: 'Registrar pago', path: '/payments/new', requiredPermission: 'payments.view' },
        { label: 'Seguimiento de cartera', path: '/payments/portfolio-tracking', requiredPermission: 'payments.view' },
        { label: 'Cobros del día', path: '/payments/daily-collections', requiredPermission: 'payments.view' },
        { label: 'Historial de pagos', path: '/payments/history', requiredPermission: 'payments.view' }],
    });
  });
  it('publishes profitability under Finanzas and nested Reportes with the existing cash permission', () => {
    const finance = navigationEntries.find((entry) => entry.label === 'Finanzas');
    expect(finance?.type).toBe('group');
    if (finance?.type !== 'group') return;
    expect(finance.items[0]).toMatchObject({ type: 'link', label: 'Movimientos de caja',
      path: '/finance/cash-movements', requiredPermission: 'cash-movements.view' });
    expect(finance.items[2]).toMatchObject({ type: 'group', label: 'Reportes', requiredPermission: 'cash-movements.view',
      items: [{ type: 'link', label: 'Rentabilidad integral', path: '/finance/reports/profitability',
        requiredPermission: 'cash-movements.view' }] });
    expect(getActiveGroupIds(navigationEntries, '/finance/reports/profitability'))
      .toEqual(['finance', 'finance.reports']);
    expect(filterNavigationEntries(navigationEntries, () => false).some((entry) => entry.label === 'Finanzas')).toBe(false);
    expect(filterNavigationEntries(navigationEntries, (permission) => permission === 'cash-movements.view')
      .find((entry) => entry.label === 'Finanzas')).toMatchObject({ type: 'group', items: [
        { label: 'Movimientos de caja' }, { label: 'Reportes', items: [{ label: 'Rentabilidad integral' }] },
      ] });
  });
  it('publishes monthly close independently with its dedicated view permission', () => {
    const allowed = filterNavigationEntries(navigationEntries, (permission) => permission === 'financial-closes.view');
    expect(allowed.find((entry) => entry.label === 'Finanzas')).toMatchObject({ type: 'group', items: [
      { label: 'Cierre financiero mensual', path: '/finance/financial-closes', requiredPermission: 'financial-closes.view' },
    ] });
    expect(getActiveGroupIds(navigationEntries, '/finance/financial-closes')).toEqual(['finance']);
  });
  it('publishes customer financial analysis only with its dedicated permission', () => {
    const allowed = filterNavigationEntries(navigationEntries, (permission) => permission === 'customers.analysis.view');
    const customers = allowed.find((entry) => entry.label === 'Clientes');
    expect(customers).toMatchObject({ type: 'group', items: [{ type: 'link', label: 'Análisis financiero',
      path: '/customers/financial-analysis', requiredPermission: 'customers.analysis.view' }] });
    expect(filterNavigationEntries(navigationEntries, () => false).some((entry) => entry.label === 'Clientes')).toBe(false);
  });
  it('publishes the requested customer navigation options in order', () => {
    const customers = navigationEntries.find((entry) => entry.label === 'Clientes');
    expect(customers?.type).toBe('group');
    if (customers?.type !== 'group') return;
    expect(customers.items).toMatchObject([
      { label: 'Clientes', path: '/customers', requiredPermission: 'customers.view' },
      { label: 'Nuevo cliente', path: '/customers/new', requiredPermission: 'customers.create' },
      { label: 'Análisis financiero', path: '/customers/financial-analysis', requiredPermission: 'customers.analysis.view' },
      { label: 'Estadísticas de clientes', path: '/customers/statistics', requiredPermission: 'customers.summary.view' },
    ]);
    expect(customers.items.some((entry) => entry.label === 'Clientes asignados')).toBe(false);
  });
  it('publishes only administrative collector options and reports in the requested order', () => {
    const collectors = navigationEntries.find((entry) => entry.label === 'Cobradores');
    expect(collectors?.type).toBe('group');
    if (collectors?.type !== 'group') return;
    expect(collectors.items).toMatchObject([
      { label: 'Cobradores', path: '/collectors', requiredPermission: 'collectors.view' },
      { label: 'Rutas y asignaciones', path: '/collectors/route-assignments', requiredPermission: 'collectors.view' },
      { label: 'Agenda de clientes', path: '/collectors/customer-agenda', requiredPermission: 'customers.view' },
      { label: 'Agenda de cobros', path: '/collectors/collection-agenda', requiredPermission: 'collection-agenda.view' },
      { label: 'Cobros por cobrador', path: '/payments/collector-report', requiredPermission: 'payments.view' },
      { label: 'Estadísticas', path: '/collectors/statistics', requiredPermission: 'payments.view' },
    ]);
    expect(JSON.stringify(collectors.items)).not.toContain('/collector/customers');
    expect(JSON.stringify(collectors.items)).not.toContain('/collector/loans');
    expect(JSON.stringify(collectors.items)).not.toContain('/collector/daily-collections');
    expect(getActiveGroupIds(navigationEntries, '/payments/collector-report')).toEqual(['collector']);
    expect(getActiveGroupIds(navigationEntries, '/collectors/statistics')).toEqual(['collector']);
    const statisticsOnly = filterNavigationEntries(navigationEntries, (permission) => permission === 'payments.view');
    expect(statisticsOnly.find((entry) => entry.label === 'Cobradores')).toMatchObject({ type: 'group', items: [
      { label: 'Cobros por cobrador', path: '/payments/collector-report' },
      { label: 'Estadísticas', path: '/collectors/statistics' },
    ] });
    expect(statisticsOnly.find((entry) => entry.label === 'PAGOS')).toMatchObject({ type: 'group', items: [
      { label: 'Registrar pago' }, { label: 'Seguimiento de cartera' }, { label: 'Cobros del día' }, { label: 'Historial de pagos' },
    ] });
    const managementOnly = filterNavigationEntries(navigationEntries, (permission) => permission === 'collectors.view');
    expect(managementOnly.find((entry) => entry.label === 'Cobradores')).toMatchObject({ type: 'group', items: [
      { label: 'Cobradores' }, { label: 'Rutas y asignaciones', path: '/collectors/route-assignments' },
    ] });
    expect(getActiveGroupIds(navigationEntries, '/collectors/route-assignments')).toEqual(['collector']);
    expect(getActiveGroupIds(navigationEntries, '/collectors/customer-agenda')).toEqual(['collector']);
    expect(getActiveGroupIds(navigationEntries, '/collectors/collection-agenda')).toEqual(['collector']);
    const agendaOnly = filterNavigationEntries(navigationEntries, (permission) => permission === 'collection-agenda.view');
    expect(agendaOnly.find((entry) => entry.label === 'Cobradores')).toMatchObject({ type: 'group', items: [
      { label: 'Agenda de cobros', path: '/collectors/collection-agenda' },
    ] });
    const customerAgendaOnly = filterNavigationEntries(navigationEntries, (permission) => permission === 'customers.view');
    expect(customerAgendaOnly.find((entry) => entry.label === 'Cobradores')).toMatchObject({ type: 'group', items: [
      { label: 'Agenda de clientes', path: '/collectors/customer-agenda' },
    ] });
  });
  it('adds Agenda de clientes without replacing the five existing scoped links for a non-superadmin COLLECTOR', () => {
    const collector = { role: { code: 'COLLECTOR', isSuperAdmin: false } };
    const entries = navigationEntriesFor(collector);
    expect(entries).toBe(collectorNavigationEntries);
    expect(entries).toMatchObject([{ type: 'group', label: 'COBRADOR', items: [
      { label: 'Mis clientes', path: '/collector/customers', requiredPermission: 'customers.assigned.view' },
      { label: 'Agenda de clientes', path: '/collectors/customer-agenda', requiredPermission: 'customers.assigned.view' },
      { label: 'Mis préstamos activos', path: '/collector/loans', requiredPermission: 'loans.assigned.view' },
      { label: 'Mi resumen financiero', path: '/collector/financial-summary', requiredPermission: 'collectors.financial-summary.view' },
      { label: 'Mis cobros del día', path: '/collector/daily-collections', requiredPermission: 'daily-collections.assigned.view', icon: 'payment' },
      { label: 'Mi agenda de cobros', path: '/collectors/collection-agenda', requiredPermission: 'collection-agenda.view', icon: 'payment' },
    ] }]);
    const visible = filterNavigationEntries(entries, () => true);
    expect(visible[0]?.type === 'group' && visible[0].items.map((entry) => entry.label)).toEqual([
      'Mis clientes', 'Agenda de clientes', 'Mis préstamos activos', 'Mi resumen financiero', 'Mis cobros del día', 'Mi agenda de cobros',
    ]);
    expect(JSON.stringify(visible)).not.toContain('Inicio');
  });
  it('filters each new COLLECTOR link by its scoped permission', () => {
    const collector = { role: { code: 'COLLECTOR', isSuperAdmin: false } };
    const daily = filterNavigationEntries(navigationEntriesFor(collector),
      (permission) => permission === 'daily-collections.assigned.view');
    const agenda = filterNavigationEntries(navigationEntriesFor(collector),
      (permission) => permission === 'collection-agenda.view');
    const customers = filterNavigationEntries(navigationEntriesFor(collector),
      (permission) => permission === 'customers.assigned.view');
    expect(daily).toMatchObject([{ type: 'group', items: [
      { label: 'Mis cobros del día', path: '/collector/daily-collections', requiredPermission: 'daily-collections.assigned.view' },
    ] }]);
    expect(JSON.stringify(daily)).not.toContain('Mi agenda de cobros');
    expect(agenda).toMatchObject([{ type: 'group', items: [
      { label: 'Mi agenda de cobros', path: '/collectors/collection-agenda', requiredPermission: 'collection-agenda.view' },
    ] }]);
    expect(JSON.stringify(agenda)).not.toContain('Mis cobros del día');
    expect(customers).toMatchObject([{ type: 'group', items: [
      { label: 'Mis clientes', path: '/collector/customers', requiredPermission: 'customers.assigned.view' },
      { label: 'Agenda de clientes', path: '/collectors/customer-agenda', requiredPermission: 'customers.assigned.view' },
    ] }]);
  });
  it('uses the administrative projection without personal collector options for ADMIN, manager and SUPERADMIN', () => {
    const adminEntries = navigationEntriesFor({ role: { code: 'ADMIN', isSuperAdmin: false } });
    const managerEntries = navigationEntriesFor({ role: { code: 'COLLECTION_MANAGER', isSuperAdmin: false } });
    expect(adminEntries).toBe(navigationEntries);
    expect(managerEntries).toBe(navigationEntries);
    expect(navigationEntriesFor({ role: { code: 'COLLECTOR', isSuperAdmin: true } })).toBe(navigationEntries);
    for (const entries of [adminEntries, managerEntries]) {
      expect(JSON.stringify(entries)).not.toContain('/collector/customers');
      expect(JSON.stringify(entries)).not.toContain('/collector/loans');
      expect(JSON.stringify(entries)).not.toContain('/collector/daily-collections');
    }
  });
  it('places new loan second without changing the remaining loan entries', () => {
    const loans = navigationEntries.find((entry) => entry.label === 'PRÉSTAMOS');
    expect(loans?.type).toBe('group');
    if (loans?.type !== 'group') return;
    expect(loans.items.map((entry) => entry.label)).toEqual(['Préstamos', 'Nuevo préstamo', 'Préstamos cancelados', 'Préstamos incobrables', 'Préstamos anulados', 'Refinanciamientos']);
    expect(loans.items[1]).toMatchObject({ type: 'link', path: '/loans/new', icon: 'payment', requiredPermission: 'loans.create' });
    expect(loans.items[2]).toMatchObject({ path: '/loans/cancelled', requiredPermission: 'loans.view' });
    expect(loans.items[3]).toMatchObject({ type: 'link', path: '/loans/uncollectible-management', icon: 'payment', requiredPermission: 'loans.view' });
    expect(loans.items[4]).toMatchObject({ type: 'link', path: '/loans/annulments', icon: 'payment', requiredPermission: 'loans.view' });
    expect(getActiveGroupIds(navigationEntries, '/loans/cancelled')).toEqual(['loans']);
    expect(getActiveGroupIds(navigationEntries, '/loans/uncollectible-management')).toEqual(['loans']);
    expect(getActiveGroupIds(navigationEntries, '/loans/annulments')).toEqual(['loans']);
    expect(loans.items[5]).toMatchObject({ type: 'group', requiredPermission: 'loans.refinance.view',
      items: [{ label: 'Refinanciamientos', path: '/loan-refinancings', requiredPermission: 'loans.refinance.view' },
        { label: 'Nuevo refinanciamiento', path: '/loan-refinancings/new', requiredPermission: 'loans.refinance.view' },
        { label: 'Cadenas de refinanciamiento', path: '/loan-refinancings/chains', requiredPermission: 'loans.refinance.view' }] });
    expect(getActiveGroupIds(navigationEntries, '/loan-refinancings')).toEqual(['loans', 'loans.refinancings']);
    expect(getActiveGroupIds(navigationEntries, '/loan-refinancings/new')).toEqual(['loans', 'loans.refinancings']);
    expect(getActiveGroupIds(navigationEntries, '/loan-refinancings/operation-id')).toEqual(['loans', 'loans.refinancings']);
    expect(getActiveGroupIds(navigationEntries, '/loan-refinancings/chains')).toEqual(['loans', 'loans.refinancings']);
    expect(getActiveGroupIds(navigationEntries, '/loan-refinancings/chains/loan/loan-id')).toEqual(['loans', 'loans.refinancings']);
    if (loans.items[5].type === 'group') {
      const [listing, creation, chains] = loans.items[5].items;
      expect(isNavigationEntryActive(listing, '/loan-refinancings/new')).toBe(false);
      expect(isNavigationEntryActive(creation, '/loan-refinancings/new')).toBe(true);
      expect(isNavigationEntryActive(listing, '/loan-refinancings/operation-id')).toBe(true);
      expect(isNavigationEntryActive(listing, '/loan-refinancings/chains/loan/loan-id')).toBe(false);
      expect(isNavigationEntryActive(chains, '/loan-refinancings/chains/loan/loan-id')).toBe(true);
    }
    const denied = filterNavigationEntries(navigationEntries, () => false).find((entry) => entry.label === 'PRÉSTAMOS');
    expect(denied).toBeUndefined();
    expect(filterNavigationEntries(navigationEntries, (permission) => permission === 'loans.status.uncollectible')
      .some((entry) => entry.label === 'PRÉSTAMOS')).toBe(false);
    const allowed = filterNavigationEntries(navigationEntries, (permission) => permission === 'loans.view').find((entry) => entry.label === 'PRÉSTAMOS');
    expect(allowed?.type === 'group' && allowed.items.map((entry) => entry.label)).toEqual(['Préstamos', 'Préstamos cancelados', 'Préstamos incobrables', 'Préstamos anulados']);
    const refinanceOnly = filterNavigationEntries(navigationEntries, (permission) => permission === 'loans.refinance.view')
      .find((entry) => entry.label === 'PRÉSTAMOS');
    expect(refinanceOnly?.type === 'group' && refinanceOnly.items.map((entry) => entry.label)).toEqual(['Refinanciamientos']);
    if (refinanceOnly?.type === 'group' && refinanceOnly.items[0].type === 'group') {
      expect(refinanceOnly.items[0].items.map((entry) => entry.label)).toEqual([
        'Refinanciamientos', 'Nuevo refinanciamiento', 'Cadenas de refinanciamiento',
      ]);
    }
  });

  it('opens both parent groups and identifies the active territorial child route', () => {
    expect(getActiveGroupIds(navigationEntries, '/settings/cantons')).toEqual([
      'settings',
      'settings.territorial',
    ]);

    const territorial = navigationEntries
      .find((entry) => entry.label === 'Configuración');
    if (territorial?.type !== 'group') return;
    const childGroup = territorial.items.find((entry) => entry.label === 'División territorial');
    if (childGroup?.type !== 'group') return;

    expect(isNavigationEntryActive(childGroup, '/settings/cantons')).toBe(true);
    expect(isNavigationEntryActive(childGroup.items[1], '/settings/cantons')).toBe(true);
    expect(isNavigationEntryActive(childGroup.items[0], '/settings/cantons')).toBe(false);
  });

  it('supports the existing group expand/collapse behavior', () => {
    expect(toggleExpandedGroup(['settings'], 'settings.territorial')).toEqual([
      'settings',
      'settings.territorial',
    ]);
    expect(toggleExpandedGroup(['settings', 'settings.territorial'], 'settings.territorial')).toEqual(['settings']);
  });
  it('uses stable and unique ids for every navigation entry', () => {
    const collectIds = (entries: typeof navigationEntries): string[] => entries.flatMap((entry) => [
      entry.id,
      ...(entry.type === 'group' ? collectIds(entry.items) : []),
    ]);

    const ids = collectIds(navigationEntries);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain('customers');
    expect(ids).toContain('settings.territorial');
    expect(ids).toContain('loans.new');
  });

  it('keeps only one top-level group open at a time', () => {
    expect(toggleAccordionGroup(['customers'], 'loans', 0)).toEqual(['loans']);
    expect(toggleAccordionGroup(['settings', 'settings.territorial'], 'loans', 0)).toEqual(['loans']);
  });

  it('closes a top-level group together with its nested groups', () => {
    expect(toggleAccordionGroup(['settings', 'settings.territorial'], 'settings', 0)).toEqual([]);
  });

  it('restores the active nested branch when reopening its top-level group', () => {
    expect(toggleAccordionGroup([], 'settings', 0, ['settings', 'settings.territorial'])).toEqual([
      'settings',
      'settings.territorial',
    ]);
  });

  it('keeps nested groups independently expandable inside the open top-level group', () => {
    expect(toggleAccordionGroup(['settings'], 'settings.territorial', 1)).toEqual([
      'settings',
      'settings.territorial',
    ]);
    expect(toggleAccordionGroup(['settings', 'settings.territorial'], 'settings.territorial', 1)).toEqual(['settings']);
  });

});
