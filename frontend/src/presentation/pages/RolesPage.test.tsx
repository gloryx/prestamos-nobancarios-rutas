import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { buildPermissionGroups } from '../helpers/permission-matrix';
import { PermissionOptions } from './RolesPage';

const records = [
  { id: '1', module: 'Clientes', code: 'customers.assigned.view', name: 'Ver clientes asignados' },
  { id: '2', module: 'PRÉSTAMOS', code: 'loans.assigned.view', name: 'Ver préstamos asignados' },
  { id: '3', module: 'COBRADORES', code: 'collectors.financial-summary.view', name: 'Ver mi resumen financiero' },
  { id: '4', module: 'COBRANZAS', code: 'daily-collections.assigned.view', name: 'Ver cobros del día asignados' },
  { id: '5', module: 'COBRANZAS', code: 'collection-agenda.view', name: 'Ver agenda de cobros' },
];

describe('Roles and permissions scoped catalog rendering', () => {
  it('renders a checkbox, friendly label and exact code for every permission returned by the endpoint', () => {
    const html = buildPermissionGroups(records).map((group) => renderToStaticMarkup(<PermissionOptions group={group}
      selectedCodes={['customers.assigned.view']} disabled={false} onToggle={vi.fn()} />)).join('');
    for (const permission of records) {
      expect(html).toContain(permission.name);
      expect(html).toContain(permission.code);
    }
    expect(html.match(/type="checkbox"/g)).toHaveLength(5);
    expect(html).toContain('checked=""');
  });
});
