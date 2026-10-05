import { afterEach, describe, expect, it, vi } from 'vitest';
import { generateCustomerReport } from './customer-report.service';

const app = vi.hoisted(() => ({ exportAll: vi.fn() }));
const pdf = vi.hoisted(() => ({ options: vi.fn(), text: vi.fn(), save: vi.fn(), setPage: vi.fn(), autoTable: vi.fn() }));

vi.mock('../../app/customers', () => ({ customerUseCases: { exportAll: { execute: app.exportAll } } }));
vi.mock('jspdf', () => ({ jsPDF: class {
  internal = { pageSize: { getWidth: () => 279.4, getHeight: () => 215.9 } };
  constructor(options: unknown) { pdf.options(options); }
  setFontSize = vi.fn();
  text = pdf.text;
  getNumberOfPages = () => 2;
  setPage = pdf.setPage;
  save = pdf.save;
} }));
vi.mock('jspdf-autotable', () => ({ autoTable: pdf.autoTable }));

describe('customer portfolio PDF', () => {
  afterEach(() => { vi.useRealTimers(); vi.clearAllMocks(); });

  it('exports the complete active and inactive portfolio in alphabetical order', async () => {
    vi.useFakeTimers(); vi.setSystemTime(new Date(2026, 9, 4, 18, 30));
    app.exportAll.mockResolvedValue([
      { identification: '202', fullName: 'ZOE VEGA', primaryPhone: '2222', province: 'ALAJUELA', canton: 'CENTRAL', district: 'ALAJUELA', isActive: true },
      { identification: '101', fullName: 'ANA MORA', primaryPhone: '1111', province: 'SAN JOSÉ', canton: 'CENTRAL', district: 'CARMEN', isActive: false },
    ]);

    await generateCustomerReport();

    expect(app.exportAll).toHaveBeenCalledOnce();
    expect(pdf.options).toHaveBeenCalledWith({ orientation: 'landscape', format: 'letter', unit: 'mm' });
    expect(pdf.text).toHaveBeenCalledWith('Reporte de Clientes', 10, 14);
    expect(pdf.text).toHaveBeenCalledWith('Total de clientes: 2', 10, 27);
    expect(pdf.text).toHaveBeenCalledWith('Clientes activos: 1 | Clientes inactivos: 1', 10, 33);
    expect(pdf.autoTable.mock.calls[0][1]).toMatchObject({
      head: [['#', 'Identificación', 'Nombre completo', 'Teléfono', 'Provincia', 'Cantón', 'Distrito', 'Estado']],
      body: [
        ['1', '101', 'ANA MORA', '1111', 'SAN JOSÉ', 'CENTRAL', 'CARMEN', 'INACTIVO'],
        ['2', '202', 'ZOE VEGA', '2222', 'ALAJUELA', 'CENTRAL', 'ALAJUELA', 'ACTIVO'],
      ],
      pageBreak: 'auto', showHead: 'everyPage', margin: { top: 10, right: 10, bottom: 14, left: 10 },
    });
    expect(pdf.setPage.mock.calls).toEqual([[1], [2]]);
    expect(pdf.text).toHaveBeenCalledWith('Página 1 de 2', 269.4, 209.9, { align: 'right' });
    expect(pdf.text).toHaveBeenCalledWith('Página 2 de 2', 269.4, 209.9, { align: 'right' });
    expect(pdf.save).toHaveBeenCalledWith('clientes_2026-10-04.pdf');
    expect(JSON.stringify(pdf.autoTable.mock.calls[0][1])).not.toMatch(/private|fotograf|coorden|latitud|longitud|acciones/i);
  });
});
