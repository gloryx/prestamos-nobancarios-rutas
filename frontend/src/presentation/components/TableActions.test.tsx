import { renderToStaticMarkup } from 'react-dom/server';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it } from 'vitest';
import { TableActions } from './TableActions';

describe('TableActions', () => {
  it('renders enabled navigation actions as links and disabled ones as buttons', () => {
    const html = renderToStaticMarkup(<MemoryRouter><TableActions actions={[
      { key: 'enabled', icon: 'hand-coins', label: 'Nuevo préstamo', title: 'Nuevo préstamo', ariaLabel: 'Otorgar nuevo préstamo', to: '/loans/new' },
      { key: 'disabled', icon: 'hand-coins', label: 'Nuevo préstamo', title: 'El cliente debe estar activo', ariaLabel: 'Otorgar nuevo préstamo', to: '/loans/new', disabled: true },
    ]} /></MemoryRouter>);

    expect(html.match(/href="\/loans\/new"/g)).toHaveLength(1);
    expect(html).toContain('<button type="button" title="El cliente debe estar activo" aria-label="Otorgar nuevo préstamo" disabled=""');
  });
});
