import type { CustomerSite, SiteUpdateScope } from '../../domain/entities/customer-site';

export function siteCaptureState(site: CustomerSite, authorization?: { scope: SiteUpdateScope; expiresAt: string; status?: string }) {
  const locationExists = site.latitude !== null && site.longitude !== null;
  const photoExists = site.hasPropertyPhoto;
  const active = authorization?.status === undefined || authorization.status === 'ACTIVE' ? authorization : undefined;
  const replacement = active && new Date(active.expiresAt).getTime() > Date.now() ? active : undefined;
  return { locationExists, photoExists, canReplaceLocation: Boolean(replacement && (replacement.scope === 'LOCATION' || replacement.scope === 'LOCATION_AND_PHOTO')), canReplacePhoto: Boolean(replacement && (replacement.scope === 'PHOTO' || replacement.scope === 'LOCATION_AND_PHOTO')) };
}
