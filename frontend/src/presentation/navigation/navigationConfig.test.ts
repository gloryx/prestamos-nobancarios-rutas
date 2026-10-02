import { describe, expect, it } from 'vitest';
import {
  filterNavigationEntries,
  getActiveGroupIds,
  isNavigationEntryActive,
  navigationEntries,
  toggleAccordionGroup,
  toggleExpandedGroup,
} from './navigationConfig';

describe('sidebar navigation configuration', () => {
  const allowAll = () => true;

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
      items: [{ type: 'link', label: 'Registrar pago', path: '/payments/new', icon: 'payment', requiredPermission: 'payments.view' }],
    });
    if (payments?.type !== 'group') return;
    expect(payments.items).toHaveLength(1);
    expect(getActiveGroupIds(navigationEntries, '/payments/new')).toEqual(['payments']);
  });

  it('filters registration by payments.view using the existing navigation helper', () => {
    const denied = filterNavigationEntries(navigationEntries, (permission) => permission !== 'payments.view');
    const allowed = filterNavigationEntries(navigationEntries, (permission) => permission === 'payments.view');

    expect(denied.some((entry) => entry.label === 'PAGOS')).toBe(false);
    expect(allowed.find((entry) => entry.label === 'PAGOS')).toMatchObject({
      type: 'group',
      items: [{ label: 'Registrar pago', path: '/payments/new', requiredPermission: 'payments.view' }],
    });
  });
  it('adds one loans.view management link without hiding or reordering existing loan entries', () => {
    const loans = navigationEntries.find((entry) => entry.label === 'PRÉSTAMOS');
    expect(loans?.type).toBe('group');
    if (loans?.type !== 'group') return;
    expect(loans.items.map((entry) => entry.label)).toEqual(['Préstamos', 'Préstamos cancelados', 'Préstamos incobrables', 'Préstamos anulados', 'Nuevo préstamo']);
    expect(loans.items[1]).toMatchObject({ path: '/loans/cancelled', requiredPermission: 'loans.view' });
    expect(loans.items[2]).toMatchObject({ type: 'link', path: '/loans/uncollectible-management', icon: 'payment', requiredPermission: 'loans.view' });
    expect(loans.items[3]).toMatchObject({ type: 'link', path: '/loans/annulments', icon: 'payment', requiredPermission: 'loans.view' });
    expect(getActiveGroupIds(navigationEntries, '/loans/cancelled')).toEqual(['loans']);
    expect(getActiveGroupIds(navigationEntries, '/loans/uncollectible-management')).toEqual(['loans']);
    expect(getActiveGroupIds(navigationEntries, '/loans/annulments')).toEqual(['loans']);
    const denied = filterNavigationEntries(navigationEntries, () => false).find((entry) => entry.label === 'PRÉSTAMOS');
    expect(denied).toBeUndefined();
    expect(filterNavigationEntries(navigationEntries, (permission) => permission === 'loans.status.uncollectible')
      .some((entry) => entry.label === 'PRÉSTAMOS')).toBe(false);
    const allowed = filterNavigationEntries(navigationEntries, (permission) => permission === 'loans.view').find((entry) => entry.label === 'PRÉSTAMOS');
    expect(allowed?.type === 'group' && allowed.items.map((entry) => entry.label)).toEqual(['Préstamos', 'Préstamos cancelados', 'Préstamos incobrables', 'Préstamos anulados']);
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
