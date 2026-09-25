import { useEffect, useState, type ReactElement } from 'react';
import { Link, useParams } from 'react-router-dom';
import { customerUseCases } from '../../app/customers';
import type { CustomerDetail } from '../../domain/entities/customer';
import type { AssignedCollector, CustomerSite, SiteAuthorization, SiteUpdateScope } from '../../domain/entities/customer-site';
import { generateCustomerFileReport } from '../../infrastructure/reports/customer-file-report.service';
import { formatNationality } from '../formatters/nationality';
import { useAuth } from '../hooks/auth-context';

export function CustomerDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const { can, canAll } = useAuth();
  const [item, setItem] = useState<CustomerDetail>();
  const [site, setSite] = useState<CustomerSite>();
  const [authorizations, setAuthorizations] = useState<SiteAuthorization[]>([]);
  const [assignedCollectors, setAssignedCollectors] = useState<AssignedCollector[]>([]);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [images, setImages] = useState<{ identification?: string; property?: string }>({});
  const [preview, setPreview] = useState('');
  const [authorizationOpen, setAuthorizationOpen] = useState(false);
  const [authorizationError, setAuthorizationError] = useState('');
  const [authorizationForm, setAuthorizationForm] = useState({ collectorUserId: '', scope: 'LOCATION_AND_PHOTO' as SiteUpdateScope, reason: '', expiresAt: defaultExpiry() });

  const fetchFile = async (customerId: string, kind: 'identification' | 'property') => {
    if (!can('customers.files.view')) throw new Error('No tienes permiso para acceder a los archivos del cliente.');
    return customerUseCases.file.execute(customerId, kind);
  };

  useEffect(() => {
    let active = true;
    void customerUseCases.get.execute(id).then((value) => { if (active) setItem(value); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'No se pudo cargar el cliente.')).finally(() => setLoading(false));
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    let active = true;
    void customerUseCases.site.execute(id).then((value) => { if (active) setSite(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [id]);
  useEffect(() => {
    if (!can('customers.site.replace.authorize')) return;
    let active = true;
    void customerUseCases.authorizations.execute(id).then((value) => { if (active) setAuthorizations(value); }).catch(() => undefined);
    void customerUseCases.assignedCollectors.execute(id).then((value) => { if (active) setAssignedCollectors(value); }).catch(() => undefined);
    return () => { active = false; };
  }, [id, can]);
  useEffect(() => {
    if (!can('customers.files.view')) return;
    let active = true;
    void Promise.allSettled([fetchFile(id, 'identification'), fetchFile(id, 'property')]).then(([identification, property]) => {
      if (!active) return;
      setImages({ identification: identification.status === 'fulfilled' ? URL.createObjectURL(identification.value) : undefined, property: property.status === 'fulfilled' ? URL.createObjectURL(property.value) : undefined });
    });
    return () => { active = false; };
  }, [id, can]);
  useEffect(() => () => { Object.values(images).forEach((url) => { if (url) URL.revokeObjectURL(url); }); }, [images]);

  if (loading) return <div className="catalog-message">Cargando cliente…</div>;
  if (error || !item) return <div className="catalog-message catalog-message--error">{error || 'Cliente no encontrado.'}</div>;

  const c = item.customer;
  const a = item.address;
  const hierarchy = `${item.district.name} · ${item.district.canton.name} · ${item.district.canton.province.name}`;
  const saveAuthorization = async () => {
    if (!authorizationForm.collectorUserId || !authorizationForm.reason.trim()) { setAuthorizationError('Selecciona un cobrador y escribe un motivo.'); return; }
    try {
      const created = await customerUseCases.authorizeSiteUpdate.execute(id, authorizationForm);
      setAuthorizations((current) => [created, ...current]);
      setAuthorizationOpen(false);
    } catch (cause) { setAuthorizationError(cause instanceof Error ? cause.message : 'No se pudo crear la autorización.'); }
  };
  const revokeAuthorization = async (authorizationId: string) => {
    try {
      await customerUseCases.revokeSiteAuthorization.execute(id, authorizationId);
      setAuthorizations((current) => current.map((value) => value.id === authorizationId ? { ...value, revokedAt: new Date().toISOString(), status: 'REVOKED' } : value));
    } catch (cause) { setAuthorizationError(cause instanceof Error ? cause.message : 'No se pudo revocar la autorización.'); }
  };

  return <section className="customer-detail-page">
    <div className="customer-admin__heading"><div><p className="eyebrow">GESTIÓN / CLIENTES</p><h2>{c.firstName} {c.firstLastName}</h2><p className="muted">{c.identification}</p></div><div className="payment-actions">{canAll(['customers.export', 'customers.files.view']) && <button className="button button--secondary" onClick={() => void generateCustomerFileReport(item, fetchFile)}>Descargar expediente</button>}{can('customers.update') && <Link className="button button--primary" to={`/customers/${id}/edit`}>Editar</Link>}</div></div>
    <div className="customer-detail-grid"><Info title="Datos personales" rows={['Identificación', c.identification, 'Género', c.gender === 'MALE' ? 'Masculino' : 'Femenino', 'Nacimiento', c.birthDate, 'Nacionalidad', formatNationality(c.nationality, c.otherNationality)]} /><Info title="Contacto" rows={['Teléfono principal', c.primaryPhone, 'Teléfono secundario', c.secondaryPhone || '—', 'Correo', c.email || '—']} /><Info title="Dirección y ubicación" rows={['Jerarquía', hierarchy, 'Dirección exacta', a.exactAddress, 'Coordenadas', a.latitude === undefined ? '—' : `${a.latitude}, ${a.longitude}`]} /><Info title="Estado y observaciones" rows={['Estado', c.isActive ? 'Activo' : 'Inactivo', 'Observaciones', c.observations || '—']} /></div>
    <SiteSection site={site} authorizations={authorizations} canAuthorize={can('customers.site.replace.authorize')} openAuthorization={() => { setAuthorizationError(''); setAuthorizationOpen(true); }} revoke={revokeAuthorization} />
    {can('customers.files.view') ? <section className="customer-documents"><h3>Documentos</h3><div className="customer-images">{images.identification ? <Doc src={images.identification} label="Identificación frontal" onPreview={setPreview} /> : <p className="muted">No hay identificación frontal cargada.</p>}{images.property && <Doc src={images.property} label="Foto de casa o negocio" onPreview={setPreview} />}</div></section> : <section className="customer-documents customer-documents--unavailable"><h3>Documentos</h3><p>No tienes permiso para consultar los documentos de este cliente.</p></section>}
    {authorizationOpen && <div className="dialog-backdrop"><div className="dialog" role="dialog" aria-modal="true"><h3>Autorizar reemplazo de sitio</h3>{authorizationError && <p className="form-error">{authorizationError}</p>}{assignedCollectors.length ? <label>Cobrador asignado<select value={authorizationForm.collectorUserId} onChange={(event) => setAuthorizationForm({ ...authorizationForm, collectorUserId: event.target.value })}><option value="">Seleccionar</option>{assignedCollectors.map((collector) => <option key={collector.id} value={collector.id}>{collector.fullName} ({collector.username})</option>)}</select></label> : <p>No hay cobradores asignados disponibles en el contrato actual del backend.</p>}<label>Alcance<select value={authorizationForm.scope} onChange={(event) => setAuthorizationForm({ ...authorizationForm, scope: event.target.value as SiteUpdateScope })}><option value="LOCATION">Solo ubicación</option><option value="PHOTO">Solo foto</option><option value="LOCATION_AND_PHOTO">Ubicación y foto</option></select></label><label>Motivo requerido<textarea value={authorizationForm.reason} onChange={(event) => setAuthorizationForm({ ...authorizationForm, reason: event.target.value })} /></label><label>Vence<input type="datetime-local" value={authorizationForm.expiresAt} onChange={(event) => setAuthorizationForm({ ...authorizationForm, expiresAt: event.target.value })} /></label><div className="dialog-actions"><button className="button button--secondary" type="button" onClick={() => setAuthorizationOpen(false)}>Cancelar</button><button className="button button--primary" type="button" disabled={!assignedCollectors.length} onClick={() => void saveAuthorization()}>Autorizar</button></div></div></div>}
    {preview && <button className="image-modal" type="button" aria-label="Cerrar vista previa" onClick={() => setPreview('')}><img src={preview} alt="Vista previa ampliada" /></button>}
  </section>;
}

function defaultExpiry(): string { const date = new Date(Date.now() + 24 * 60 * 60 * 1000); date.setSeconds(0, 0); return date.toISOString().slice(0, 16); }
function SiteSection({ site, authorizations, canAuthorize, openAuthorization, revoke }: { site?: CustomerSite; authorizations: SiteAuthorization[]; canAuthorize: boolean; openAuthorization: () => void; revoke: (id: string) => Promise<void> }): ReactElement { return <section className="customer-documents"><div className="customer-admin__heading"><h3>Datos actuales del sitio</h3>{canAuthorize && <button className="button button--secondary" type="button" onClick={openAuthorization}>Autorizar reemplazo</button>}</div>{site ? <><p className="site-summary">Ubicación: <strong>{site.latitude === null || site.longitude === null ? 'PENDIENTE' : 'REGISTRADA'}</strong> · Foto: <strong>{site.hasPropertyPhoto ? 'REGISTRADA' : 'PENDIENTE'}</strong></p>{site.latitude !== null && site.longitude !== null && <p className="map-links"><a target="_blank" rel="noopener noreferrer" href={`https://www.google.com/maps/search/?api=1&query=${site.latitude},${site.longitude}`}>Google Maps</a><a target="_blank" rel="noopener noreferrer" href={`https://www.waze.com/ul?ll=${site.latitude},${site.longitude}&navigate=yes`}>Waze</a></p>}<p className="site-audit">{site.siteDataUpdatedAt ? `Actualizado: ${new Date(site.siteDataUpdatedAt).toLocaleString()}${site.siteDataUpdatedBy ? ` · ${site.siteDataUpdatedBy.fullName}` : ''}` : 'Sin actualización de sitio registrada.'}</p></> : <p className="muted">Cargando datos del sitio…</p>}{canAuthorize && <div className="authorization-list">{authorizations.filter((value) => value.status === 'ACTIVE' || (!value.status && !value.revokedAt && !value.usedAt)).map((value) => <div className="authorization-row" key={value.id}><span><strong>{value.scope}</strong> · {value.collectorUserId} · vence {new Date(value.expiresAt).toLocaleString()}<br />{value.reason}</span><button className="button button--secondary" type="button" onClick={() => void revoke(value.id)}>Revocar</button></div>)}</div>}</section>; }
function Info({ title, rows }: { title: string; rows: string[] }): ReactElement { const pairs = []; for (let index = 0; index < rows.length; index += 2) pairs.push(<p key={rows[index]}><strong>{rows[index]}</strong><span>{rows[index + 1]}</span></p>); return <article className="customer-info-card"><h3>{title}</h3>{pairs}</article>; }
function Doc({ src, label, onPreview }: { src: string; label: string; onPreview: (value: string) => void }): ReactElement { return <figure><img src={src} alt={label} onClick={() => onPreview(src)} /><figcaption>{label}</figcaption></figure>; }
