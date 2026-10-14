import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import type { AssignedLoanDetail } from '../../domain/entities/loan';
import { PrecollectionReceiptActions } from '../components/PrecollectionReceiptActions';
import { CollectorPrecollectionCapturePage } from './CollectorPrecollectionCapturePage';

const harness = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useEffect: vi.fn(),
  useRef: (initial: unknown) => ({ current: initial }),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = typeof initial === 'function' ? (initial as () => unknown)() : initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
}));

const detail = {
  id: 'loan-1', customerId: 'customer-1', financialBalance: '100.00', reservedPrecollections: '0.00',
  operationalBalance: '100.00', activePaymentMethods: [{ id: 'cash', name: 'Efectivo' }],
} as AssignedLoanDetail;
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';

describe('collector precollection capture', () => {
  beforeEach(() => {
    harness.index = 0;
    harness.values = ['', [], false, false, '', detail,
      { amount: '', effectiveDate: '2026-10-12', paymentMethodId: '', reference: '', notes: '' }, [], false, ''];
  });

  it('keeps the preliminary-payment fields and removes the custody choice', () => {
    const view = CollectorPrecollectionCapturePage();
    const contents = text(view);
    expect(contents).toContain('Monto recibido');
    expect(contents).toContain('Fecha real del cobro');
    expect(contents).toContain('Forma de pago');
    expect(contents).toContain('Referencia (opcional)');
    expect(contents).toContain('Notas (opcional)');
    expect(contents).toContain('Saldo financiero confirmado');
    expect(contents).toContain('Precolecciones pendientes');
    expect(contents).toContain('Saldo estimado');
    expect(contents).toContain('Este registro es preliminar');
    expect(contents).not.toContain('Forma de pago activa');
    expect(contents).not.toContain('¿Quién recibió y conserva el dinero?');
    expect(contents).not.toContain('La empresa lo recibió directamente');
    expect(elements(view).filter((element) => element.type === 'input' && (element.props as { type?: string }).type === 'radio')).toHaveLength(0);
  });

  it('offers the digital receipt after a successful capture', () => {
    harness.values[10] = { id: 'precollection-1' } as CollectorPrecollectionDetail;
    const view = CollectorPrecollectionCapturePage();
    expect(text(view)).toContain('Comprobante disponible');
    expect(text(view)).toContain('El comprobante confirma el monto entregado, quién lo recibió y el saldo actualizado.');
    expect(text(view)).not.toContain('El comprobante refleja el estado y los saldos');
    expect(elements(view).some((element) => element.type === PrecollectionReceiptActions)).toBe(true);
  });
});
