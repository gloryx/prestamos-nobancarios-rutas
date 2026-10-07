import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { CustomerPhotoView, LocationConfirmation, SiteNavigationLinks, Status } from './CollectorCustomersPage';

describe('collector customer operational views', () => {
  it('uses the existing user avatar when no protected property photo is available', () => {
    const html = renderToStaticMarkup(<CustomerPhotoView name="Adrián Mena" />);
    expect(html).toContain('<svg');
    expect(html).not.toContain('<img');
  });

  it('renders a protected photo without exposing any storage key', () => {
    const html = renderToStaticMarkup(<CustomerPhotoView name="Adrián Mena" url="blob:protected-photo" />);
    expect(html).toContain('Casa o local de Adrián Mena');
    expect(html).toContain('blob:protected-photo');
    expect(html).not.toContain('clientes/casas-negocios');
  });

  it('renders an expandable, proportional protected property photo', () => {
    const html = renderToStaticMarkup(<CustomerPhotoView name="Adrián Mena" url="blob:protected-photo" large onOpen={vi.fn()} />);
    expect(html).toContain('collector-site-photo-preview');
    expect(html).toContain('collector-customer__photo--large');
    expect(html).toContain('Ampliar fotografía de la casa o local de Adrián Mena');
    expect(html).not.toContain('private/');
  });

  it('shows registered and pending states with the existing restrained status system', () => {
    const registered = renderToStaticMarkup(<Status label="Ubicación" present />);
    const pending = renderToStaticMarkup(<Status label="Fotografía" present={false} />);
    expect(registered).toContain('Ubicación ·'); expect(registered).toContain('Registrada'); expect(registered).toContain('<svg');
    expect(pending).toContain('Fotografía ·'); expect(pending).toContain('Pendiente'); expect(pending).not.toContain('<svg');
  });

  it('opens Waze and Google Maps safely with the stored destination', () => {
    const html = renderToStaticMarkup(<SiteNavigationLinks latitude={10.299274} longitude={-85.837105} />);
    expect(html).toContain('Abrir en Waze'); expect(html).toContain('Abrir en Google Maps');
    expect(html).toContain('ll=10.299274%2C-85.837105');
    expect(html).toContain('destination=10.299274%2C-85.837105');
    expect(html.match(/target="_blank"/g)).toHaveLength(2);
    expect(html.match(/rel="noopener noreferrer"/g)).toHaveLength(2);
  });

  it('requires explicit confirmation before saving a captured location', () => {
    const html = renderToStaticMarkup(<LocationConfirmation customerName="ADRIÁN MENA GONZÁLEZ" accuracy={12.4} busy={false} onCancel={vi.fn()} onSave={vi.fn()} />);
    expect(html).toContain('¿Guardar esta ubicación como ubicación de la casa/local de');
    expect(html).toContain('ADRIÁN MENA GONZÁLEZ');
    expect(html).toContain('Cancelar');
    expect(html).toContain('Guardar ubicación');
    expect(html).toContain('12 m');
  });
});
