import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { CustomerSelectionController, type CustomerSelectionState } from '../../application/use-cases/customer-selection-controller';
import type { CustomerListResult } from '../../application/ports/customer.repository';
import { CustomerSelectionModalView } from './CustomerSelectionModal';

const customer = {
  id: 'historical-customer', identification: '1-1111-1111', fullName: 'Cliente Histórico',
  primaryPhone: '8888-1111', address: 'San José', isActive: false,
};
const data: CustomerListResult = { items: [customer], total: 16, page: 1, pageSize: 10, totalPages: 2 };
const controller = new CustomerSelectionController({ list: async () => data });
const render = (state: CustomerSelectionState, canListCustomers = true) => renderToStaticMarkup(
  <CustomerSelectionModalView state={state} controller={controller} canListCustomers={canListCustomers}
    selectingId={null} onClose={() => undefined} onSelect={() => undefined} />,
);

describe('CustomerSelectionModalView', () => {
  it('renders the requested historical customer fields, actions and server pagination', () => {
    const html = render({ search: '', page: 1, data, loading: false, error: null });
    for (const text of ['Seleccionar cliente', 'Identificación', 'Nombre', 'Teléfono', 'Cliente Histórico',
      '1-1111-1111', '8888-1111', 'Seleccionar', 'Anterior', '1–1 de 16', 'Siguiente', 'Cancelar'])
      expect(html).toContain(text);
    expect(html).toContain('customer-selection-table');
    expect(html).toContain('data-label="Acción"');
  });

  it('renders loading, connectivity failure with retry and permission denial', () => {
    expect(render({ search: '', page: 1, data: null, loading: true, error: null })).toContain('Cargando clientes');
    const failed = render({ search: '', page: 1, data: null, loading: false, error: new TypeError('network') });
    expect(failed).toContain('No se pudo conectar');
    expect(failed).toContain('Reintentar');
    const forbidden = render({ search: '', page: 1, data: null, loading: false, error: null }, false);
    expect(forbidden).toContain('customers.view');
    expect(forbidden).not.toContain('Cargando clientes');
  });

  it('distinguishes an empty catalog from a search without matches', () => {
    const empty = { items: [], total: 0, page: 1, pageSize: 10, totalPages: 0 };
    expect(render({ search: '', page: 1, data: empty, loading: false, error: null })).toContain('No hay clientes disponibles');
    expect(render({ search: 'nadie', page: 1, data: empty, loading: false, error: null })).toContain('No se encontraron clientes para la búsqueda');
  });
});
