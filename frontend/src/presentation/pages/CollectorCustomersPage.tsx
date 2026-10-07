import { startTransition, useEffect, useRef, useState, type ReactElement } from 'react';
import { Camera, CheckCircle2, ChevronLeft, Map, MapPin, Navigation, Phone, Route, Search, UserRound } from 'lucide-react';
import { customerUseCases } from '../../app/customers';
import type { AssignedCustomer, AssignedCustomerQuery, AssignedCustomerResult, CustomerSite } from '../../domain/entities/customer-site';
import { CompactImageUploader } from '../components/CompactImageUploader';
import { requestCurrentLocation, validateSitePhoto, type CapturedLocation } from '../helpers/collector-location';
import { canEditSiteField, hasValidSiteCoordinates, siteCaptureState, siteNavigationUrls } from '../helpers/collector-site-state';
import { useAuth } from '../hooks/auth-context';

const initialQuery: AssignedCustomerQuery = { search: '', page: 1, pageSize: 20 };

export function CollectorCustomersPage(): ReactElement {
  const { can } = useAuth();
  const [query, setQuery] = useState(initialQuery);
  const [searchDraft, setSearchDraft] = useState('');
  const [result, setResult] = useState<AssignedCustomerResult>();
  const [selected, setSelected] = useState<AssignedCustomer>();
  const [site, setSite] = useState<CustomerSite>();
  const [loading, setLoading] = useState(true);
  const [detailLoading, setDetailLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [locating, setLocating] = useState(false);
  const [locationCandidate, setLocationCandidate] = useState<CapturedLocation>();
  const [photo, setPhoto] = useState<File>();
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const detailRequest = useRef(0);
  const canViewSite = can('customers.site.view');

  useEffect(() => {
    let current = true;
    setLoading(true);
    setError('');
    void customerUseCases.assigned.execute(query)
      .then((value) => { if (current) setResult(value); })
      .catch((cause) => { if (current) setError(cause instanceof Error ? cause.message : 'No se pudieron cargar tus clientes.'); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [query]);

  const open = (customer: AssignedCustomer) => {
    if (!canViewSite) { setError('No tenés permiso para consultar la información del sitio del cliente.'); return; }
    const request = ++detailRequest.current;
    setSelected(customer);
    setSite(undefined);
    setPhoto(undefined);
    setLocationCandidate(undefined);
    setError('');
    setSuccess('');
    setDetailLoading(true);
    void customerUseCases.site.execute(customer.id)
      .then((value) => { if (request === detailRequest.current) setSite(value); })
      .catch((cause) => { if (request === detailRequest.current) setError(cause instanceof Error ? cause.message : 'No se pudo cargar el detalle del cliente.'); })
      .finally(() => { if (request === detailRequest.current) setDetailLoading(false); });
  };

  const refresh = async (customerId: string): Promise<void> => {
    const [nextSite, nextResult] = await Promise.all([customerUseCases.site.execute(customerId), customerUseCases.assigned.execute(query)]);
    setSite(nextSite);
    setResult(nextResult);
    setSelected(nextResult.items.find((item) => item.id === customerId) ?? selected);
  };

  const requestLocation = async () => {
    setLocating(true);
    setError('');
    setSuccess('');
    try { setLocationCandidate(await requestCurrentLocation(globalThis.navigator?.geolocation)); }
    catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo obtener la ubicación actual.'); }
    finally { setLocating(false); }
  };

  const saveLocation = async () => {
    if (!selected || !locationCandidate) return;
    setBusy(true);
    setError('');
    try {
      await customerUseCases.updateSite.execute(selected.id, locationCandidate);
      await refresh(selected.id);
      setLocationCandidate(undefined);
      setSuccess('Ubicación guardada correctamente.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la ubicación.'); }
    finally { setBusy(false); }
  };

  const selectPhoto = (file?: File) => {
    const validation = validateSitePhoto(file);
    if (validation) { setError(validation); return; }
    setError('');
    setSuccess('');
    setPhoto(file);
  };

  const savePhoto = async () => {
    if (!selected || !photo) return;
    setBusy(true);
    setError('');
    try {
      await customerUseCases.updateSite.execute(selected.id, { propertyPhoto: photo });
      await refresh(selected.id);
      setPhoto(undefined);
      setSuccess('Fotografía guardada correctamente.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'No se pudo guardar la fotografía.'); }
    finally { setBusy(false); }
  };

  const state = site ? siteCaptureState(site, site.activeAuthorization) : undefined;
  const canCapture = can('customers.site.capture');
  const canReplace = can('customers.site.replace');
  const canSaveLocation = Boolean(state && canEditSiteField(state.locationExists, canCapture, canReplace, state.canReplaceLocation));
  const canSavePhoto = Boolean(state && canEditSiteField(state.photoExists, canCapture, canReplace, state.canReplacePhoto));
  const updateQuery = (patch: Partial<AssignedCustomerQuery>) => {
    detailRequest.current += 1;
    setSelected(undefined);
    setSite(undefined);
    setPhoto(undefined);
    setLocationCandidate(undefined);
    startTransition(() => setQuery((current) => ({ ...current, ...patch, page: 1 })));
  };

  return <section className="collector-page collector-customers-page">
    <header className="collector-customers-heading"><div><p className="eyebrow">COBRADORES</p><h2>MIS CLIENTES</h2><p className="muted">Clientes que actualmente corresponden a tus rutas activas.</p></div><span className="catalog-count">{result?.total ?? 0} clientes</span></header>
    <form className="collector-customer-filters" onSubmit={(event) => { event.preventDefault(); updateQuery({ search: searchDraft }); }}>
      <label className="assignment-search"><Search aria-hidden="true" /><span className="sr-only">Buscar cliente</span><input value={searchDraft} onChange={(event) => setSearchDraft(event.target.value)} placeholder="Nombre, identificación o teléfono" /></label>
      <button className="button button--secondary" type="submit">Buscar</button>
      <label><span>Ruta</span><select value={query.routeId ?? ''} onChange={(event) => updateQuery({ routeId: event.target.value || undefined })}><option value="">Todas mis rutas</option>{result?.routes.map((route) => <option key={route.id} value={route.id}>{route.name}</option>)}</select></label>
    </form>
    {error && <p className="form-error" role="alert">{error}</p>}
    {success && <p className="catalog-message catalog-message--success" role="status">{success}</p>}
    {loading && !result ? <div className="catalog-message">Cargando tus clientes…</div> : result && <div className={`collector-layout${selected ? ' collector-layout--detail' : ''}`}>
      <div className="collector-customer-column">
        {!loading && result.items.length === 0 && <div className="catalog-message">{query.search || query.routeId ? 'No hay resultados con los filtros seleccionados.' : 'No tenés clientes asignados actualmente.'}</div>}
        <div className="collector-customer-list">{result.items.map((customer) => <button className={`collector-customer${selected?.id === customer.id ? ' collector-customer--selected' : ''}`} key={customer.id} type="button" aria-pressed={selected?.id === customer.id} onClick={() => open(customer)}>
          <CustomerPropertyPhoto customer={customer} enabled={canViewSite} />
          <span className="collector-customer__body"><strong>{customer.fullName}</strong><span>{customer.identification}</span><span><Phone aria-hidden="true" />{customer.primaryPhone}</span><small><Route aria-hidden="true" />{customer.route.name}</small><span className="collector-customer__statuses"><Status label="Ubicación" present={hasValidSiteCoordinates(customer.latitude, customer.longitude)} /><Status label="Fotografía" present={customer.hasPropertyPhoto} /></span></span>
        </button>)}</div>
        {result.totalPages > 1 && <div className="assignment-pagination"><button type="button" disabled={result.page <= 1} onClick={() => setQuery((current) => ({ ...current, page: current.page - 1 }))}>Anterior</button><span>Página {result.page} de {result.totalPages}</span><button type="button" disabled={result.page >= result.totalPages} onClick={() => setQuery((current) => ({ ...current, page: current.page + 1 }))}>Siguiente</button></div>}
      </div>
      {selected && <article className="collector-site-card">
        <button className="collector-detail-back" type="button" onClick={() => { detailRequest.current += 1; setSelected(undefined); setSite(undefined); }}><ChevronLeft aria-hidden="true" />Volver a mis clientes</button>
        {detailLoading && <p className="catalog-message">Cargando detalle…</p>}
        {site && <>
          <div className="collector-site-identity"><span className="collector-customer__photo collector-customer__photo--large"><UserRound aria-hidden="true" /></span><div><h3>{site.customer.fullName}</h3><p>{site.customer.identification}</p><p><Phone aria-hidden="true" />{site.customer.primaryPhone}{site.customer.secondaryPhone ? ` · ${site.customer.secondaryPhone}` : ''}</p><p><Route aria-hidden="true" />{site.route?.name ?? selected.route.name}</p></div></div>
          <dl className="collector-site-address"><div><dt>Provincia</dt><dd>{site.address.province}</dd></div><div><dt>Cantón</dt><dd>{site.address.canton}</dd></div><div><dt>Distrito</dt><dd>{site.address.district}</dd></div><div className="collector-site-address__exact"><dt>Otras señas</dt><dd>{site.address.exactAddress}</dd></div></dl>
          {site.activeAuthorization && state && (state.canReplaceLocation || state.canReplacePhoto) && <div className="authorization-notice"><strong>REEMPLAZO AUTORIZADO</strong><span>Vence: {new Date(site.activeAuthorization.expiresAt).toLocaleString('es-CR')}</span><span>Motivo: {site.activeAuthorization.reason}</span></div>}
          <div className="collector-site-actions">
            <section><div><MapPin aria-hidden="true" /><h4>Ubicación de la casa/local</h4></div>{state?.locationExists && site.latitude !== null && site.longitude !== null ? <><RegisteredState label="Ubicación registrada" /><SiteNavigationLinks latitude={site.latitude} longitude={site.longitude} />{canSaveLocation && <button className="button button--secondary" type="button" disabled={locating || busy} onClick={() => void requestLocation()}>{locating ? 'Obteniendo GPS…' : 'Actualizar ubicación'}</button>}</> : canSaveLocation ? <><Status label="Ubicación" present={false} /><button className="button button--primary" type="button" disabled={locating || busy} onClick={() => void requestLocation()}>{locating ? 'Obteniendo GPS…' : 'Guardar ubicación actual'}</button></> : <><Status label="Ubicación" present={false} /><p className="muted">No tenés permiso para registrar la ubicación.</p></>}</section>
            <section><div><Camera aria-hidden="true" /><h4>Fotografía de la casa/local</h4></div>{state?.photoExists ? <><RegisteredState label="Fotografía registrada" /><CustomerPropertyPhoto customer={{ ...selected, hasPropertyPhoto: site.hasPropertyPhoto, siteDataUpdatedAt: site.siteDataUpdatedAt }} enabled={canViewSite} large expandable />{canSavePhoto && <><CompactImageUploader label="Actualizar fotografía" selectLabel="Seleccionar nueva fotografía" file={photo} onChange={selectPhoto} capture="environment" />{photo && <button className="button button--primary" type="button" disabled={busy} onClick={() => void savePhoto()}>{busy ? 'Guardando…' : 'Guardar fotografía'}</button>}</>}</> : canSavePhoto ? <><Status label="Fotografía" present={false} /><CompactImageUploader label="Tomar o seleccionar fotografía" file={photo} onChange={selectPhoto} capture="environment" />{photo && <button className="button button--primary" type="button" disabled={busy} onClick={() => void savePhoto()}>{busy ? 'Guardando…' : 'Guardar fotografía'}</button>}</> : <><Status label="Fotografía" present={false} /><p className="muted">No tenés permiso para registrar la fotografía.</p></>}</section>
          </div>
          {site.siteDataUpdatedAt && <p className="site-audit">Última actualización: {new Date(site.siteDataUpdatedAt).toLocaleString('es-CR')}</p>}
        </>}
      </article>}
    </div>}
    {locationCandidate && selected && <LocationConfirmation customerName={selected.fullName} accuracy={locationCandidate.accuracy} busy={busy} onCancel={() => setLocationCandidate(undefined)} onSave={() => void saveLocation()} />}
  </section>;
}

function CustomerPropertyPhoto({ customer, enabled, large = false, expandable = false }: { customer: AssignedCustomer; enabled: boolean; large?: boolean; expandable?: boolean }): ReactElement {
  const [url, setUrl] = useState<string>();
  const [expanded, setExpanded] = useState(false);
  useEffect(() => {
    let current = true;
    let objectUrl: string | undefined;
    setUrl(undefined);
    setExpanded(false);
    if (!enabled || !customer.hasPropertyPhoto) return () => { current = false; };
    void customerUseCases.sitePhoto.execute(customer.id).then((blob) => { if (!current) return; objectUrl = URL.createObjectURL(blob); setUrl(objectUrl); }).catch(() => undefined);
    return () => { current = false; if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [customer.id, customer.hasPropertyPhoto, customer.siteDataUpdatedAt, enabled]);
  return <><CustomerPhotoView name={customer.fullName} url={url} large={large} onOpen={expandable && url ? () => setExpanded(true) : undefined} />{expanded && url && <button className="image-modal" type="button" aria-label="Cerrar fotografía" onClick={() => setExpanded(false)}><img src={url} alt={`Casa o local de ${customer.fullName}`} /></button>}</>;
}

export function CustomerPhotoView({ name, url, large = false, onOpen }: { name: string; url?: string; large?: boolean; onOpen?: () => void }): ReactElement {
  const photo = <span className={`collector-customer__photo${large ? ' collector-customer__photo--large' : ''}`}>{url ? <img src={url} alt={`Casa o local de ${name}`} /> : <UserRound aria-hidden="true" />}</span>;
  return onOpen && url ? <button className="collector-site-photo-preview" type="button" aria-label={`Ampliar fotografía de la casa o local de ${name}`} onClick={onOpen}>{photo}</button> : photo;
}

export function SiteNavigationLinks({ latitude, longitude }: { latitude: number; longitude: number }): ReactElement {
  const links = siteNavigationUrls(latitude, longitude);
  return <nav className="collector-site-navigation" aria-label="Navegación a la casa o local"><a className="button button--primary" href={links.waze} target="_blank" rel="noopener noreferrer"><Navigation aria-hidden="true" />Abrir en Waze</a><a className="button button--secondary" href={links.googleMaps} target="_blank" rel="noopener noreferrer"><Map aria-hidden="true" />Abrir en Google Maps</a></nav>;
}

function RegisteredState({ label }: { label: string }): ReactElement {
  return <p className="site-registered"><CheckCircle2 aria-hidden="true" />{label}</p>;
}

export function LocationConfirmation({ customerName, accuracy, busy, onCancel, onSave }: { customerName: string; accuracy: number; busy: boolean; onCancel(): void; onSave(): void }): ReactElement {
  return <div className="collector-location-confirmation" role="dialog" aria-modal="true" aria-labelledby="location-confirmation-title"><div><MapPin aria-hidden="true" /><h3 id="location-confirmation-title">Confirmar ubicación</h3></div><p>¿Guardar esta ubicación como ubicación de la casa/local de <strong>{customerName}</strong>?</p><small>Precisión aproximada: {Math.round(accuracy)} m</small><div><button className="button button--secondary" type="button" disabled={busy} onClick={onCancel}>Cancelar</button><button className="button button--primary" type="button" disabled={busy} onClick={onSave}>{busy ? 'Guardando…' : 'Guardar ubicación'}</button></div></div>;
}

export function Status({ label, present }: { label: string; present: boolean }): ReactElement {
  return <span className={`site-status${present ? ' site-status--present' : ''}`}>{present && <CheckCircle2 aria-hidden="true" />}<strong>{label} ·</strong>{present ? 'Registrada' : 'Pendiente'}</span>;
}
