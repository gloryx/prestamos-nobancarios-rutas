import type { CustomerSite, SiteUpdateScope } from '../../domain/entities/customer-site';

export function hasValidSiteCoordinates(latitude: number | null, longitude: number | null): boolean {
  return latitude !== null && longitude !== null && Number.isFinite(latitude) && Number.isFinite(longitude)
    && latitude >= -90 && latitude <= 90 && longitude >= -180 && longitude <= 180;
}

export function siteNavigationUrls(latitude: number, longitude: number): { waze: string; googleMaps: string } {
  if (!hasValidSiteCoordinates(latitude, longitude)) throw new Error('Las coordenadas registradas no son válidas.');
  const coordinates = `${latitude},${longitude}`;
  const waze = new URL('https://waze.com/ul');
  waze.search = new URLSearchParams({ ll: coordinates, navigate: 'yes', utm_source: 'prestamos-nobancarios' }).toString();
  const googleMaps = new URL('https://www.google.com/maps/dir/');
  googleMaps.search = new URLSearchParams({ api: '1', destination: coordinates, travelmode: 'driving', dir_action: 'navigate' }).toString();
  return { waze: waze.toString(), googleMaps: googleMaps.toString() };
}

export function canEditSiteField(exists: boolean, canCapture: boolean, canReplace: boolean, replacementAuthorized: boolean): boolean {
  return exists ? canReplace && replacementAuthorized : canCapture;
}

export function siteCaptureState(site: CustomerSite, authorization?: { scope: SiteUpdateScope; expiresAt: string; status?: string }) {
  const locationExists = hasValidSiteCoordinates(site.latitude, site.longitude);
  const photoExists = site.hasPropertyPhoto;
  const active = authorization?.status === undefined || authorization.status === 'ACTIVE' ? authorization : undefined;
  const replacement = active && new Date(active.expiresAt).getTime() > Date.now() ? active : undefined;
  return { locationExists, photoExists, canReplaceLocation: Boolean(replacement && (replacement.scope === 'LOCATION' || replacement.scope === 'LOCATION_AND_PHOTO')), canReplacePhoto: Boolean(replacement && (replacement.scope === 'PHOTO' || replacement.scope === 'LOCATION_AND_PHOTO')) };
}
