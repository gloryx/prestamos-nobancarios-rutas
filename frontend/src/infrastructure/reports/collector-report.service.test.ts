import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Collector } from '../../domain/entities/collector';
import { generateCollectorReport } from './collector-report.service';

const pdf = vi.hoisted(() => ({ text: vi.fn(), save: vi.fn(), autoTable: vi.fn(), split: vi.fn((value: string) => [value]) }));
vi.mock('jspdf', () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 297 } };
  setFontSize = vi.fn();
  text = pdf.text;
  splitTextToSize = pdf.split;
  save = pdf.save;
} }));
vi.mock('jspdf-autotable', () => ({ autoTable: pdf.autoTable }));

const collector = (patch: Partial<Collector> = {}): Collector => ({
  id: 'private-uuid', identification: '1-2345-6789', firstName: 'Ana', firstLastName: 'Muñoz', secondLastName: 'León', phone: '8888-8888',
  birthDate: '1990-01-01', address: 'San José', userId: 'user-uuid', user: { fullName: 'User', username: 'ana' }, isActive: true, ...patch,
});

describe('collector PDF writer', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('writes local date, applied filters, accessible five-column data and repeatable compact table layout', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 8, 29, 23, 15));
    await generateCollectorReport([collector(), collector({ id: 'second-uuid', firstName: 'José', secondLastName: undefined, userId: null, user: null, isActive: false })], { status: 'INACTIVE', search: 'Muñoz' });
    expect(pdf.text.mock.calls.map(([value]) => value)).toEqual([
      'Lista de cobradores', `Fecha: ${new Date().toLocaleDateString('es-CR')} | Total: 2`, 'Estado: Inactivos', ['Búsqueda: Muñoz'],
    ]);
    expect(pdf.split).toHaveBeenCalledWith('Búsqueda: Muñoz', 277);
    const [doc, options] = pdf.autoTable.mock.calls[0];
    expect(doc).toBeDefined();
    expect(options).toMatchObject({
      startY: 38, head: [['Identificación', 'Cobrador', 'Teléfono', 'Usuario', 'Estado']],
      body: [['1-2345-6789', 'Ana Muñoz León', '8888-8888', 'ana', 'ACTIVO'], ['1-2345-6789', 'José Muñoz', '8888-8888', 'SIN VINCULAR', 'INACTIVO']],
      showHead: 'everyPage', pageBreak: 'auto', margin: { top: 10, right: 10, bottom: 15, left: 10 }, styles: { fontSize: 8, overflow: 'linebreak' },
    });
    expect(JSON.stringify([options, pdf.text.mock.calls])).not.toMatch(/private-uuid|second-uuid|user-uuid|rutas|Acciones/);
    expect(pdf.save).toHaveBeenCalledWith('cobradores-2026-09-29.pdf');
  });

  it('omits the search line when no search was applied and labels the all-status filter', async () => {
    await generateCollectorReport([collector()], { status: 'ALL', search: '   ' });
    expect(pdf.split).not.toHaveBeenCalled();
    expect(pdf.text).toHaveBeenCalledWith('Estado: Todos', 10, 27);
    expect(pdf.autoTable.mock.calls[0][1].startY).toBe(32);
  });
});
