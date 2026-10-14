import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import { PrecollectionReceiptActions } from './PrecollectionReceiptActions';

const harness = vi.hoisted(() => ({ values: [] as unknown[], index: 0 }));

vi.mock('react', async (importOriginal) => ({
  ...await importOriginal<typeof import('react')>(),
  useState: (initial: unknown) => {
    const index = harness.index++;
    if (!(index in harness.values)) harness.values[index] = initial;
    return [harness.values[index], (next: unknown) => { harness.values[index] = next; }];
  },
}));

const item = {
  id: '123e4567-e89b-12d3-a456-426614174000', receiptNumber: 'CP-000000000042',
  customerName: 'Ana Mora', customerPhone: '8888-7777',
  customerSecondaryPhone: '8777-6666', status: 'RECORDED',
} as CollectorPrecollectionDetail;
const elements = (node: ReactNode): ReactElement[] => Array.isArray(node) ? node.flatMap(elements)
  : isValidElement(node) ? [node, ...elements((node.props as { children?: ReactNode }).children)] : [];
const text = (node: ReactNode): string => Array.isArray(node) ? node.map(text).join('')
  : isValidElement(node) ? text((node.props as { children?: ReactNode }).children) : typeof node === 'string' ? node : '';

describe('precollection receipt recipient confirmation', () => {
  beforeEach(() => { harness.index = 0; harness.values = [item, null, '', '', '8777-6666']; });

  it('shows both valid phones and requires an explicit recipient choice before continuing', () => {
    const view = PrecollectionReceiptActions({ item });
    const radios = elements(view).filter((element) => element.type === 'input' && (element.props as { type?: string }).type === 'radio');
    expect(radios).toHaveLength(2);
    expect(radios.map((radio) => (radio.props as { value?: string }).value)).toEqual(['8888-7777', '8777-6666']);
    expect((radios[1].props as { checked?: boolean }).checked).toBe(true);
    expect(text(view)).toContain('Teléfono principal');
    expect(text(view)).toContain('Teléfono secundario');
    expect(text(view)).toContain('El PDF no se enviará automáticamente');
    expect(text(view)).toContain('Continuar para compartir');
    expect(text(view)).not.toContain('enviado correctamente');
  });

  it('does not offer a receipt for a cancelled collection', () => {
    harness.index = 0;
    harness.values = [];
    const view = PrecollectionReceiptActions({ item: { ...item, status: 'CANCELLED' } });
    expect(text(view)).toContain('No hay un comprobante vigente');
    expect(text(view)).not.toContain('Descargar comprobante');
    expect(text(view)).not.toContain('Compartir comprobante');
  });
});
