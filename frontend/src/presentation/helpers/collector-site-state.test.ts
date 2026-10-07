import { describe, expect, it } from 'vitest';
import type { CustomerSite } from '../../domain/entities/customer-site';
import { canEditSiteField, hasValidSiteCoordinates, siteCaptureState, siteNavigationUrls } from './collector-site-state';

const site = (latitude: number | null, photo: boolean): CustomerSite => ({ customer: { id: 'customer-1', fullName: 'Ana Mora', identification: '1', primaryPhone: '8888-0000', secondaryPhone: null }, route: { id: 'route-1', name: 'Centro' }, address: { province: 'Guanacaste', canton: 'Santa Cruz', district: 'Santa Cruz', exactAddress: 'Frente al parque' }, latitude, longitude: latitude, hasPropertyPhoto: photo, siteDataUpdatedAt: null, siteDataUpdatedBy: null });

describe('siteCaptureState', () => {
  it('keeps missing location and photo independently capturable', () => {
    expect(siteCaptureState(site(null, true))).toMatchObject({ locationExists: false, photoExists: true, canReplaceLocation: false, canReplacePhoto: false });
    expect(siteCaptureState(site(10, false))).toMatchObject({ locationExists: true, photoExists: false, canReplaceLocation: false, canReplacePhoto: false });
  });

  it('allows only the authorized replacement scope and never exposes deletion', () => {
    const state = siteCaptureState(site(10, true), { scope: 'PHOTO', expiresAt: new Date(Date.now() + 60_000).toISOString() });
    expect(state.canReplaceLocation).toBe(false);
    expect(state.canReplacePhoto).toBe(true);
    expect(state).not.toHaveProperty('delete');
  });

  it('builds official navigation URLs from stored coordinates without mutating them', () => {
    const coordinates = Object.freeze({ latitude: 10.299274, longitude: -85.837105 });
    const links = siteNavigationUrls(coordinates.latitude, coordinates.longitude);
    const waze = new URL(links.waze); const google = new URL(links.googleMaps);
    expect(waze.origin + waze.pathname).toBe('https://waze.com/ul');
    expect(waze.searchParams.get('ll')).toBe('10.299274,-85.837105');
    expect(waze.searchParams.get('navigate')).toBe('yes');
    expect(google.origin + google.pathname).toBe('https://www.google.com/maps/dir/');
    expect(google.searchParams.get('api')).toBe('1');
    expect(google.searchParams.get('destination')).toBe('10.299274,-85.837105');
    expect(google.searchParams.get('dir_action')).toBe('navigate');
    expect(coordinates).toEqual({ latitude: 10.299274, longitude: -85.837105 });
  });

  it('rejects incomplete or invalid coordinates and requires authorization for replacement', () => {
    expect(hasValidSiteCoordinates(null, -84)).toBe(false);
    expect(hasValidSiteCoordinates(91, -84)).toBe(false);
    expect(() => siteNavigationUrls(Number.NaN, -84)).toThrow('coordenadas');
    expect(canEditSiteField(false, true, false, false)).toBe(true);
    expect(canEditSiteField(true, true, false, true)).toBe(false);
    expect(canEditSiteField(true, true, true, false)).toBe(false);
    expect(canEditSiteField(true, false, true, true)).toBe(true);
  });
});
