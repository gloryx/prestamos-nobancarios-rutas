import { useEffect, useMemo, useState, type ReactElement } from 'react';
import { customerUseCases } from '../../app/customers';
import type { AssignedCustomer, CustomerSite } from '../../domain/entities/customer-site';
import { siteCaptureState } from '../helpers/collector-site-state';
import { CompactImageUploader } from '../components/CompactImageUploader';
import { useAuth } from '../hooks/auth-context';

export function CollectorCustomersPage(): ReactElement {
  const { can } = useAuth();
  const [customers, setCustomers] = useState<AssignedCustomer[]>([]);
  const [selected, setSelected] = useState<AssignedCustomer>();
  const [site, setSite] = useState<CustomerSite>();
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [photo, setPhoto] = useState<File>();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = () => void customerUseCases.assigned.execute().then(setCustomers).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los clientes asignados.'));
  useEffect(load, []);
  const open = (customer: AssignedCustomer) => { setSelected(customer); setSite(undefined); setError(''); void customerUseCases.site.execute(customer.id).then((value) => { setSite(value); setLatitude(value.latitude === null ? '' : String(value.latitude)); setLongitude(value.longitude === null ? '' : String(value.longitude)); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el sitio.')); };
  const state = useMemo(() => site ? siteCaptureState(site, site.activeAuthorization) : undefined, [site]);
  const locationNeeded = state && (!state.locationExists || state.canReplaceLocation);
  const photoNeeded = state && (!state.photoExists || state.canReplacePhoto);
  const capture = async () => {
    if (!selected || !site) return;
    const hasLocation = latitude.trim() !== '' || longitude.trim() !== '';
    if (hasLocation && (!latitude.trim() || !longitude.trim())) { setError('La latitud y la longitud deben enviarse juntas.'); return; }
    setBusy(true); setError('');
    try { await customerUseCases.updateSite.execute(selected.id, { latitude: locationNeeded && hasLocation ? Number(latitude) : undefined, longitude: locationNeeded && hasLocation ? Number(longitude) : undefined, propertyPhoto: photoNeeded ? photo : undefined }); const refreshed = await customerUseCases.site.execute(selected.id); setSite({ ...refreshed, activeAuthorization: undefined }); setPhoto(undefined); setLatitude(refreshed.latitude === null ? '' : String(refreshed.latitude)); setLongitude(refreshed.longitude === null ? '' : String(refreshed.longitude)); await load(); } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudieron guardar los datos del sitio.'); } finally { setBusy(false); }
  };
  const locate = () => navigator.geolocation?.getCurrentPosition((position) => { setLatitude(String(position.coords.latitude)); setLongitude(String(position.coords.longitude)); }, () => setError('No se pudo obtener la ubicación del dispositivo.'));
  return <section className="collector-page"><div className="customer-admin__heading"><div><p className="eyebrow">OPERACIÓN / COBRANZA</p><h2>Clientes asignados</h2><p className="muted">Registra únicamente datos de sitio de clientes asignados a tu ruta.</p></div><span className="catalog-count">{customers.length} clientes</span></div>{error && <p className="form-error" role="alert">{error}</p>}{!customers.length ? <div className="catalog-message">No hay clientes asignados.</div> : <div className="collector-layout"><div className="collector-customer-list">{customers.map((customer) => <button className={`collector-customer ${selected?.id === customer.id ? 'collector-customer--selected' : ''}`} key={customer.id} type="button" onClick={() => open(customer)}><strong>{customer.fullName}</strong><span>{customer.identification}</span><small>{customer.route.name}</small><div><Status label="Ubicación" present={customer.latitude !== null && customer.longitude !== null} /><Status label="Foto" present={customer.hasPropertyPhoto} /></div></button>)}</div>{selected && <article className="collector-site-card"><h3>{selected.fullName}</h3><p className="muted">{selected.identification} · {selected.route.name}</p>{site ? <><div className="site-status-grid"><Status label="Ubicación" present={state?.locationExists ?? false} /><Status label="Foto" present={state?.photoExists ?? false} /></div>{site.activeAuthorization && state && (state.canReplaceLocation || state.canReplacePhoto) && <div className="authorization-notice"><strong>REEMPLAZO AUTORIZADO</strong><span>Alcance: {site.activeAuthorization.scope}</span><span>Vence: {new Date(site.activeAuthorization.expiresAt).toLocaleString()}</span><span>Motivo: {site.activeAuthorization.reason}</span></div>} {(locationNeeded || photoNeeded) && (can('customers.site.capture') || can('customers.site.replace')) ? <div className="site-capture-form">{locationNeeded && <><div className="location-actions"><button type="button" className="button button--secondary" onClick={locate}>Usar mi ubicación</button><span>Coordenadas manuales</span></div><div className="form-grid"><label>Latitud<input type="number" step="any" value={latitude} onChange={(event) => setLatitude(event.target.value)} /></label><label>Longitud<input type="number" step="any" value={longitude} onChange={(event) => setLongitude(event.target.value)} /></label></div></>}{photoNeeded && <CompactImageUploader label={state?.photoExists ? 'Reemplazar foto del inmueble' : 'Foto del inmueble'} file={photo} allowRemove={false} onChange={setPhoto} />}{latitude && longitude && <MapLinks latitude={latitude} longitude={longitude} />}<button type="button" className="button button--primary" disabled={busy || (!photo && !(latitude && longitude))} onClick={() => void capture()}>{busy ? 'Guardando…' : 'Guardar datos del sitio'}</button></div> : <p className="muted">{state?.locationExists && state.photoExists ? 'Datos completos. No hay acciones de eliminación disponibles.' : 'No hay controles disponibles para registrar estos datos.'}</p>}{state?.locationExists && <MapLinks latitude={String(site.latitude)} longitude={String(site.longitude)} />} {site.siteDataUpdatedAt && <p className="site-audit">Actualizado: {new Date(site.siteDataUpdatedAt).toLocaleString()}{site.siteDataUpdatedBy ? ` · ${site.siteDataUpdatedBy.fullName}` : ''}</p>}</> : <p className="muted">Cargando datos del sitio…</p>}</article>}</div>}</section>;
}

function Status({ label, present }: { label: string; present: boolean }): ReactElement { return <span className={`site-status ${present ? 'site-status--present' : ''}`}><strong>{label}</strong>{present ? 'REGISTRADA' : 'PENDIENTE'}</span>; }
function MapLinks({ latitude, longitude }: { latitude: string; longitude: string }): ReactElement { const query = encodeURIComponent(`${latitude},${longitude}`); return <p className="map-links"><a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${query}`}>Google Maps</a><a target="_blank" rel="noopener noreferrer" href={`https://www.waze.com/ul?ll=${query}&navigate=yes`}>Waze</a></p>; }
