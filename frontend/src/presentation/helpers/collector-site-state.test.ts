import { describe, expect, it } from 'vitest';
import type { CustomerSite } from '../../domain/entities/customer-site';
import { siteCaptureState } from './collector-site-state';

const site = (latitude: number | null, photo: boolean): CustomerSite => ({ latitude, longitude: latitude, hasPropertyPhoto: photo, siteDataUpdatedAt: null, siteDataUpdatedBy: null });

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
});
