import { describe, expect, it, vi } from 'vitest';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import {
  canIssuePrecollectionReceipt,
  createPrecollectionReceiptDocument,
  createPrecollectionReceiptPdf,
  precollectionPhoneOptions,
  precollectionReceiptRows,
  precollectionWhatsAppUrl,
  sharePrecollectionReceiptDocument,
  whatsappPhone,
} from './collector-precollection-receipt.service';

const receipt = (overrides: Partial<CollectorPrecollectionDetail> = {}): CollectorPrecollectionDetail => ({
  id: '123e4567-e89b-12d3-a456-426614174000', receiptNumber: 'CP-000000000042',
  collectorId: 'collector', collectorUserId: 'collector-user',
  customerId: 'customer', loanId: 'loan', routeId: 'route', customerRouteAssignmentId: 'customer-route',
  collectorRouteAssignmentId: 'collector-route', paymentMethodId: 'method', custodyTreatment: 'COLLECTOR_HELD',
  amount: '25.00', effectiveDate: '2026-10-10', reference: 'REC-20', notes: null, status: 'RECORDED',
  recordedByUserId: 'collector-user', recordedAt: '2026-10-10T12:00:00.000Z', cancelledByUserId: null,
  cancelledAt: null, cancellationReason: null, collectorName: 'Carlos Cobrador', customerName: 'Ana Mora',
  customerIdentification: '1-1111-1111', customerPhone: '8888-7777', customerSecondaryPhone: '8777-6666',
  loanNumber: '42', routeName: 'Centro', paymentMethodName: 'SINPE', recordedByName: 'Carlos Cobrador',
  cancelledByName: null, financialBalance: '80.00', reservedPrecollections: '35.00', operationalBalance: '45.00',
  customerBalanceBefore: '70.00', customerBalanceAfter: '45.00', ...overrides,
});

const page = (doc: Awaited<ReturnType<typeof createPrecollectionReceiptDocument>>) =>
  (doc.internal.pages as unknown as string[][])[1].join('\n');
const textRuns = (contents: string) => [...contents.matchAll(/BT\n\/F\d+ ([\d.]+) Tf[\s\S]*?([\d.]+) ([\d.]+) Td\n\(([^)]*)\) Tj\nET/g)]
  .map(([, size, x, y, text]) => ({ size: Number(size), x: Number(x), y: Number(y), text }));

describe('collector precollection receipt', () => {
  it('contains the customer receipt facts without exposing internal status, balances or the UUID', () => {
    const rows = Object.fromEntries(precollectionReceiptRows(receipt()));
    expect(rows).toMatchObject({ Comprobante: 'CP-000000000042', Cliente: 'Ana Mora', Préstamo: '42',
      'Fecha del cobro': '10/10/2026', 'Monto recibido': '¢25', 'Forma de pago': 'SINPE',
      Referencia: 'REC-20', Cobrador: 'Carlos Cobrador', 'Saldo anterior': '¢70',
      'Cobro recibido': '¢25', 'Saldo actual': '¢45' });
    expect(rows).not.toHaveProperty('Identificador');
    expect(rows).not.toHaveProperty('Estado');
    expect(rows).not.toHaveProperty('Saldo confirmado');
    expect(rows).not.toHaveProperty('Cobros pendientes');
    expect(rows).not.toHaveProperty('Saldo estimado');
    for (const technicalIdentifier of ['Número de pago', 'ID de pago', 'ID de precolección', 'Identificador']) {
      expect(rows).not.toHaveProperty(technicalIdentifier);
    }
  });

  it.each([
    'RECORDED', 'SUBMITTED', 'SETTLED',
  ] as const)('renders the same client-safe one-page document for internal status %s', async (status) => {
    const document = await createPrecollectionReceiptDocument(receipt({ status }), new Date('2026-10-13T12:00:00.000Z'));
    const contents = page(document);
    expect(document.getNumberOfPages()).toBe(1);
    expect(document.internal.pageSize.getWidth()).toBeCloseTo(80, 1);
    expect(document.internal.pageSize.getHeight()).toBeCloseTo(170, 1);
    expect(contents).toContain('Comprobante de cobro');
    expect(contents).toContain('CP-000000000042');
    expect(contents).toContain('Carlos Cobrador');
    expect(contents).toContain('Resumen del préstamo');
    expect(contents).toContain('Saldo anterior');
    expect(contents).toContain('Cobro recibido');
    expect(contents).toContain('Saldo actual');
    expect(contents).toContain('Emitido');
    expect(contents).not.toContain(receipt().id);
    for (const text of ['Pendiente de liquidación', 'Dinero recibido por el cobrador', 'Saldo confirmado',
      'Cobros pendientes', 'Saldo estimado', 'Pago pendiente', 'En proceso', 'Sin liquidar']) {
      expect(contents).not.toContain(text);
    }
    for (const text of ['Número de pago', 'ID de pago', 'ID de precolección']) expect(contents).not.toContain(text);
  });

  it.each(['REJECTED', 'CANCELLED'] as const)('does not issue a customer receipt for invalid status %s', async (status) => {
    const item = receipt({ status });
    expect(canIssuePrecollectionReceipt(item)).toBe(false);
    expect(() => precollectionReceiptRows(item)).toThrow('cannot be issued');
    await expect(createPrecollectionReceiptDocument(item)).rejects.toThrow('cannot be issued');
    expect(precollectionWhatsAppUrl(item)).toBeNull();
  });

  it('keeps long text and large amounts inside the printable width without label overlap', async () => {
    const item = receipt({
      customerName: 'María Fernanda Rodríguez de la Cruz y Villalobos Nombre Particularmente Extenso',
      collectorName: 'Carlos Alberto Fernández Rodríguez Cobrador de Ruta Extendida',
      paymentMethodName: 'Transferencia electrónica interbancaria de referencia extendida',
      reference: 'REFERENCIA-DE-TRANSFERENCIA-MUY-LARGA-2026-00000000000001', amount: '9999999999999999.99',
    });
    const document = await createPrecollectionReceiptDocument(item, new Date('2026-10-13T12:00:00.000Z'));
    const contents = page(document); const runs = textRuns(contents); const pageWidth = document.internal.pageSize.getWidth() * document.internal.scaleFactor;
    expect(document.getNumberOfPages()).toBe(1);
    expect(runs.length).toBeGreaterThan(10);
    for (const run of runs) {
      expect(run.x).toBeGreaterThanOrEqual(-0.5);
      expect(run.x + document.getTextWidth(run.text) * document.internal.scaleFactor).toBeLessThanOrEqual(pageWidth + 0.5);
    }
  });

  it('generates a non-empty PDF with the short receipt number in its filename', async () => {
    const document = await createPrecollectionReceiptPdf(receipt(), new Date('2026-10-13T12:00:00.000Z'));
    expect(document.filename).toBe('comprobante-cp-000000000042.pdf');
    expect(document.blob.type).toBe('application/pdf');
    expect(document.blob.size).toBeGreaterThan(500);
  });

  it('shares the PDF natively without downloading or opening WhatsApp', async () => {
    const share = vi.fn().mockResolvedValue(undefined); const download = vi.fn(); const openWhatsApp = vi.fn();
    const document = { blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'receipt.pdf' };
    await expect(sharePrecollectionReceiptDocument(document, receipt(), '8888-7777', {
      navigator: { canShare: () => true, share }, createFile: () => ({ name: 'receipt.pdf' }) as File,
      download, openWhatsApp,
    })).resolves.toBe('NATIVE_SHARE_COMPLETED');
    expect(share).toHaveBeenCalledWith(expect.objectContaining({ files: [expect.objectContaining({ name: 'receipt.pdf' })] }));
    expect(download).not.toHaveBeenCalled(); expect(openWhatsApp).not.toHaveBeenCalled();
  });

  it('downloads and opens a prepared WhatsApp draft for the selected phone', async () => {
    const download = vi.fn(); const openWhatsApp = vi.fn();
    const document = { blob: new Blob(['pdf'], { type: 'application/pdf' }), filename: 'receipt.pdf' };
    await expect(sharePrecollectionReceiptDocument(document, receipt(), '8777-6666', {
      navigator: {}, createFile: () => ({ name: 'receipt.pdf' }) as File, download, openWhatsApp,
    })).resolves.toBe('DOWNLOADED_AND_WHATSAPP_OPENED');
    expect(download).toHaveBeenCalledWith(document);
    expect(openWhatsApp).toHaveBeenCalledWith(expect.stringContaining('https://wa.me/50687776666?text='));
    const message = decodeURIComponent(openWhatsApp.mock.calls[0][0]);
    expect(message).toContain('Ana Mora'); expect(message).toContain('préstamo 42'); expect(message).toContain('monto ₡25');
    expect(message).toContain('recibido por Carlos Cobrador el 10/10/2026');
    expect(message).toContain('Saldo actual ₡45');
    expect(message).toContain('PDF debe adjuntarse manualmente');
    expect(message).not.toContain('saldo estimado');
    expect(message).not.toContain('liquidación');
  });

  it('normalizes Costa Rican and international recipients and offers two distinct phones', () => {
    expect(whatsappPhone('8888-7777')).toBe('50688887777');
    expect(whatsappPhone('+506 8888-7777')).toBe('50688887777');
    expect(whatsappPhone('00 1 305 555 0100')).toBe('13055550100');
    expect(whatsappPhone('+34 612 345 678')).toBe('34612345678');
    expect(whatsappPhone('123')).toBeNull();
    expect(precollectionPhoneOptions(receipt()).map((option) => option.phone)).toEqual(['50688887777', '50687776666']);
    expect(precollectionPhoneOptions(receipt({ customerSecondaryPhone: '+506 8888-7777' }))).toHaveLength(1);
    expect(precollectionWhatsAppUrl(receipt({ customerPhone: '123' }), '123')).toBeNull();
  });
});
