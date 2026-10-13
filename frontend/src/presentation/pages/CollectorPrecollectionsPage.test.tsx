import { Children, isValidElement, type ReactElement, type ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { collectorPrecollectionEmptyMessage } from '../helpers/stage3b';
import { CollectorDateNavigation } from './CollectorPrecollectionsPage';

const elements = (node: ReactNode): ReactElement[] => Children.toArray(node).flatMap((child) =>
  isValidElement(child) ? [child, ...elements((child.props as { children?: ReactNode }).children)] : []);

describe('collector precollection date navigation', () => {
  it('shows the selected date and navigates across month and year boundaries', () => {
    const onChange = vi.fn();
    const view = CollectorDateNavigation({ date: '2026-01-01', today: '2027-01-02', onChange });
    const buttons = elements(view).filter((element) => element.type === 'button');
    const button = (label: string) => buttons.find((element) => (element.props as { children?: ReactNode }).children === label);

    expect(renderToStaticMarkup(view)).toContain('Fecha seleccionada:</strong> 01/01/2026');
    (button('Anterior')?.props as { onClick?: () => void }).onClick?.();
    (button('Siguiente')?.props as { onClick?: () => void }).onClick?.();
    (button('Hoy')?.props as { onClick?: () => void }).onClick?.();

    expect(onChange.mock.calls.map(([date]) => date)).toEqual(['2025-12-31', '2026-01-02', '2027-01-02']);
  });

  it('identifies today, prevents future navigation and explains an empty selected day', () => {
    const onChange = vi.fn();
    const view = CollectorDateNavigation({ date: '2026-10-12', today: '2026-10-12', onChange });
    const html = renderToStaticMarkup(view);
    const next = elements(view).find((element) => element.type === 'button' &&
      (element.props as { children?: ReactNode }).children === 'Siguiente');

    expect(html).toContain('Fecha seleccionada:</strong> Hoy · 12/10/2026');
    expect((next?.props as { disabled?: boolean }).disabled).toBe(true);
    expect(collectorPrecollectionEmptyMessage('2026-10-12')).toBe('No hay cobros registrados para el 12/10/2026.');
  });
});
