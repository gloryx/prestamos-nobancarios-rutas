import { describe, expect, it, vi } from 'vitest';
import type { LoanOperationalDetail } from '../../domain/entities/loan';
import { getPdfMoneyText } from './loan-payment-plan-pdf.helpers';
import { createLoanPaymentPlanDocument, generateLoanPaymentPlanReport } from './loan-payment-plan-report.service';

const now = new Date(2026, 3, 2, 14, 5);
const loan: LoanOperationalDetail = {
  id: 'private-loan-uuid', loanNumber: '42', status: 'ACTIVE', customerId: 'private-customer-uuid',
  customerName: 'María Fernanda Rodríguez de la Cruz', identification: '101010101', startDate: '2026-01-01',
  principal: '1000.00', interestAmount: '200.00', totalAmount: '1200.00', pendingTotal: '700.00',
  financialBalance: '700.00', frequencyName: 'Quincenal', preferredPaymentMethod: 'Efectivo',
  disbursementPaymentMethod: 'Efectivo', createdByName: 'Creator', updatedAt: '2026-01-01T00:00:00Z',
  intervalUnit: 'DAY/15', intervalValue: 1,
  collectionProjection: { overdueAmount: '300.00', scheduledAmount: '400.00', totalSuggestedAmount: '700.00', operationalDate: '2026-04-02', operationalDateKind: 'SCHEDULED' },
  validPayments: [
    { id: 'payment-b', paymentDate: '2026-02-01', amount: '100.00', status: 'VALID' },
    { id: 'payment-a', paymentDate: '2026-02-01', amount: '400.00', status: 'VALID',
      applications: [{ planEntryId: 'paid-15', sequence: 15, amountApplied: '400.00' }] },
    { id: 'annulled', paymentDate: '2026-03-01', amount: '900.00', status: 'ANNULLED' as 'VALID' },
  ],
  plan: [
    { id: 'plan-3', sequence: 3, dueDate: '2026-02-01', pendingAmount: '300.00' },
    { id: 'plan-0', sequence: 1, dueDate: '2026-03-01', pendingAmount: '0.00' },
    { id: 'plan-5', sequence: 5, dueDate: '2026-04-02', pendingAmount: '400.00' },
  ],
};

const pages = (doc: Awaited<ReturnType<typeof createLoanPaymentPlanDocument>>) =>
  (doc.internal.pages as unknown as string[][]).slice(1).map((page) => page.join('\n'));
const timelineRows = (page: string) => [
  ...[...page.matchAll(/\((\d{2}\/\d{2}\/\d{4}) {2}\) Tj[\s\S]*?\(PAGO RECIBIDO\) Tj/g)]
    .map((match) => ({ index: match.index, reference: 'PAGO RECIBIDO', date: match[1], state: 'PAGO RECIBIDO' })),
  ...[...page.matchAll(/\(CUOTA (\d+) {2}(\d{2}\/\d{2}\/\d{4}) {2}\) Tj[\s\S]*?\((PENDIENTE|VENCIDA)\) Tj/g)]
    .map((match) => ({ index: match.index, reference: `Cuota ${match[1]}`, date: match[2], state: match[3] })),
].sort((left, right) => left.index - right.index).map(({ reference, date, state }) => ({ reference, date, state }));
const textRuns = (page: string) => [...page.matchAll(/BT\n\/F\d+ ([\d.]+) Tf[\s\S]*?([\d.]+) ([\d.]+) Td\n\(([^)]*)\) Tj\nET/g)]
  .map(([, size, x, y, text]) => ({ size: Number(size), x: Number(x), y: Number(y), text }));
const textTransform = (page: string, text: string) => {
  const lines = page.split('\n');
  const index = lines.indexOf(`(${text}) Tj`);
  return lines.slice(0, index).reverse().find((line) => line.endsWith(' Tm'));
};
const textFontSize = (page: string, text: string) => {
  const lines = page.split('\n');
  const index = lines.indexOf(`(${text}) Tj`);
  return Number(lines.slice(0, index).reverse().find((line) => /^\/F\d+ [\d.]+ Tf$/.test(line))!.split(' ')[1]);
};

describe('existing shared loan payment-plan receipt', () => {
  it('prints payment movements and contractual installment sequences without zero or annulled rows', async () => {
    const [page] = pages(await createLoanPaymentPlanDocument(loan, now));
    expect(timelineRows(page)).toEqual([
      { reference: 'PAGO RECIBIDO', date: '01/02/2026', state: 'PAGO RECIBIDO' },
      { reference: 'PAGO RECIBIDO', date: '01/02/2026', state: 'PAGO RECIBIDO' },
      { reference: 'Cuota 3', date: '01/02/2026', state: 'VENCIDA' },
      { reference: 'Cuota 5', date: '02/04/2026', state: 'PENDIENTE' },
    ]);
    expect(page.indexOf('(PAGOS RECIBIDOS) Tj')).toBeLessThan(page.indexOf('(CUOTAS PENDIENTES) Tj'));
    expect(page).not.toContain('CUOTA 1  01/03/2026');
    expect(page).not.toMatch(/Aplicado a cuota|aplicaciones históricas|planEntryId|paid-15/);
    expect(page).not.toContain('(¢900)');
    expect(page).toContain('(¢700)');
    expect(page).toContain('(¢500)');
    expect(page).not.toContain('private-loan-uuid');
    expect(page).toContain('02/04/2026 14:05');
    expect(page).toContain('1/1');
    expect(page).not.toMatch(/Cobrado|Por cobrar/);
  });

  it('keeps verified applications internal while preserving the real payment and contractual pending rows', async () => {
    const fixture: LoanOperationalDetail = { ...loan, loanNumber: '4664', financialBalance: '200000.00', pendingTotal: '200000.00',
      validPayments: [{ id: 'ffc5ebe9-c24f-416d-9c01-7f4d7c60ac25', paymentDate: '2026-10-12', amount: '20000.00', status: 'VALID',
        applications: [{ planEntryId: 'entry-15', sequence: 15, amountApplied: '20000.00' }] }],
      plan: [
        { id: 'entry-15', sequence: 15, dueDate: '2026-10-08', pendingAmount: '0.00' },
        { id: 'entry-16', sequence: 16, dueDate: '2026-10-09', pendingAmount: '20000.00' },
        { id: 'entry-17', sequence: 17, dueDate: '2026-10-10', pendingAmount: '20000.00' },
        { id: 'entry-18', sequence: 18, dueDate: '2026-10-12', pendingAmount: '160000.00' },
      ] };
    const [page] = pages(await createLoanPaymentPlanDocument(fixture, new Date(2026, 9, 12, 18)));
    expect(page).toContain('(PAGO RECIBIDO) Tj');
    expect(page).not.toMatch(/Aplicado a cuota|entry-15|applications/);
    expect(timelineRows(page)).toEqual([
      { reference: 'PAGO RECIBIDO', date: '12/10/2026', state: 'PAGO RECIBIDO' },
      { reference: 'Cuota 16', date: '09/10/2026', state: 'VENCIDA' },
      { reference: 'Cuota 17', date: '10/10/2026', state: 'VENCIDA' },
      { reference: 'Cuota 18', date: '12/10/2026', state: 'PENDIENTE' },
    ]);
    expect(page).not.toContain('(CUOTA 15  12/10/2026  ) Tj');
  });

  it('orders real payments chronologically without requiring historical application details', async () => {
    const fixture = { ...loan, validPayments: [
      { id: 'newer', paymentDate: '2026-03-02', amount: '75.00', status: 'VALID' as const },
      { id: 'older', paymentDate: '2026-01-15', amount: '25.00', status: 'VALID' as const },
    ] };
    const [page] = pages(await createLoanPaymentPlanDocument(fixture, now));
    expect(timelineRows(page).slice(0, 2)).toEqual([
      { reference: 'PAGO RECIBIDO', date: '15/01/2026', state: 'PAGO RECIBIDO' },
      { reference: 'PAGO RECIBIDO', date: '02/03/2026', state: 'PAGO RECIBIDO' },
    ]);
    expect(page.indexOf('(¢25) Tj')).toBeLessThan(page.indexOf('(¢75) Tj'));
    expect(page).not.toContain('Sin aplicaciones históricas disponibles');
  });

  it('prints reprogrammed pending installments with their contractual sequence, current date and pending amount', async () => {
    const fixture = { ...loan, validPayments: [], plan: [
      { id: 'later-sequence', sequence: 12, dueDate: '2026-06-20', pendingAmount: '125.00' },
      { id: 'reprogrammed', sequence: 8, dueDate: '2026-05-10', pendingAmount: '275.00' },
      { id: 'settled', sequence: 7, dueDate: '2026-04-01', pendingAmount: '0.00' },
    ] };
    const [page] = pages(await createLoanPaymentPlanDocument(fixture, now));
    expect(timelineRows(page)).toEqual([
      { reference: 'Cuota 8', date: '10/05/2026', state: 'PENDIENTE' },
      { reference: 'Cuota 12', date: '20/06/2026', state: 'PENDIENTE' },
    ]);
    expect(page).toContain('(¢275) Tj');
    expect(page).toContain('(¢125) Tj');
    expect(page).not.toContain('CUOTA 7');
  });

  it('colors each state token, aligns it to the black date and resets ink before the amount', async () => {
    const document = await createLoanPaymentPlanDocument(loan, now);
    const [page] = pages(document);
    const paid = page.match(/0\. g\n0\. Tc\n([\d.]+) ([\d.]+) Td\n\(01\/02\/2026 {2}\) Tj\nET\nBT\n\/F2 7\.5 Tf\n8\.625 TL\n0\.094 0\.388 0\.216 rg\n0\. Tc\n([\d.]+) ([\d.]+) Td\n\(PAGO RECIBIDO\) Tj/);
    expect(paid).not.toBeNull();
    document.setFont('helvetica', 'bold');
    document.setFontSize(7.5);
    expect(Number(paid![3]) - Number(paid![1])).toBeCloseTo(document.getTextWidth('01/02/2026  ') * document.internal.scaleFactor, 4);
    expect(paid![4]).toBe(paid![2]);
    const amount = page.match(/\(PAGO RECIBIDO\) Tj\nET\nBT\n\/F1 7\.5 Tf\n8\.625 TL\n0\. g\n0\. Tc\n([\d.]+) ([\d.]+) Td\n\(¢400\) Tj/);
    expect(amount?.[2]).toBe(paid![4]);
    expect(page).toMatch(/0\.863 0\.149 0\.149 rg[\s\S]*?\(PENDIENTE\) Tj\nET\nBT[\s\S]*?0\. g[\s\S]*?\(¢400\) Tj/);
    expect(page).toMatch(/0\.863 0\.149 0\.149 rg[\s\S]*?\(VENCIDA\) Tj\nET\nBT[\s\S]*?0\. g[\s\S]*?\(¢300\) Tj/);
    expect(page).toMatch(/0\. g\n0\. Tc\n[\d.]+ [\d.]+ Td\n\(¢400\) Tj/);
  });

  it.each([['50.00', '1150.00'], ['350.00', '850.00']])('shows the full %s payment rather than the scheduled installment', async (amount, balance) => {
    const fixture = { ...loan, financialBalance: balance, validPayments: [{ id: 'payment', paymentDate: '2026-02-01', amount, status: 'VALID' as const }],
      plan: [{ id: 'plan', sequence: 3, dueDate: '2026-02-01', pendingAmount: '300.00' }] };
    const [page] = pages(await createLoanPaymentPlanDocument(fixture, now));
    expect(timelineRows(page).map(({ state }) => state)).toEqual(['PAGO RECIBIDO', 'VENCIDA']);
    expect(page).toContain(getPdfMoneyText(amount));
    expect(page).toContain(getPdfMoneyText('300.00'));
    expect(page).toContain(getPdfMoneyText(balance));
  });

  it('renders the larger green cancelled watermark behind a readable real balance', async () => {
    const document = await createLoanPaymentPlanDocument({ ...loan, status: 'CANCELLED', financialBalance: '700.00' }, now);
    const [page] = pages(document);
    expect(page).toContain('CANCELADO');
    expect(page).toContain('¢700');
    expect(page).toMatch(/\/F2 30 Tf[\s\S]*?0\.137 0\.42 0\.271 rg[\s\S]*?\(CANCELADO\) Tj/);
    expect(page.indexOf('(CANCELADO) Tj')).toBeLessThan(page.indexOf('(Plan de pago) Tj'));
    const pdf = new TextDecoder('latin1').decode(new Uint8Array(document.output('arraybuffer')));
    expect(pdf).toContain('/ca 0.2');
    document.setFont('helvetica', 'bold');
    document.setFontSize(30);
    expect(document.getTextWidth('CANCELADO')).toBeGreaterThan(60);
    expect(document.getTextWidth('CANCELADO')).toBeLessThanOrEqual(72);
  });

  it('fits the centered red REFINANCIADO watermark inside safe rotated bounds without changing CANCELADO', async () => {
    const cancelled = await createLoanPaymentPlanDocument({ ...loan, status: 'CANCELLED' }, now);
    const refinanced = await createLoanPaymentPlanDocument({ ...loan, status: 'REFINANCED' }, now);
    const [cancelledPage] = pages(cancelled);
    const [refinancedPage] = pages(refinanced);
    expect(cancelledPage).toMatch(/\/F2 30 Tf[\s\S]*?0\.137 0\.42 0\.271 rg[\s\S]*?\(CANCELADO\) Tj/);
    expect(refinancedPage).toMatch(/0\.569 0\.176 0\.176 rg[\s\S]*?\(REFINANCIADO\) Tj/);
    const cancelledTransform = textTransform(cancelledPage, 'CANCELADO')!.split(' ').slice(0, 6).map(Number);
    const refinancedTransform = textTransform(refinancedPage, 'REFINANCIADO')!.split(' ').slice(0, 6).map(Number);
    expect(refinancedTransform.slice(0, 4)).toEqual(cancelledTransform.slice(0, 4));
    expect(refinancedPage.indexOf('(REFINANCIADO) Tj')).toBeLessThan(refinancedPage.indexOf('(Plan de pago) Tj'));
    const pdf = new TextDecoder('latin1').decode(new Uint8Array(refinanced.output('arraybuffer')));
    expect(pdf).toContain('/ca 0.2');
    const fontSize = textFontSize(refinancedPage, 'REFINANCIADO');
    expect(fontSize).toBeGreaterThan(29);
    expect(fontSize).toBeLessThan(30);
    refinanced.setFont('helvetica', 'bold');
    refinanced.setFontSize(fontSize);
    const { w, h } = refinanced.getTextDimensions('REFINANCIADO');
    const scaleFactor = refinanced.internal.scaleFactor;
    const [a, b, c, d, e, f] = refinancedTransform;
    const corners = [[e, f], [e + a * w * scaleFactor, f + b * w * scaleFactor],
      [e + c * h * scaleFactor, f + d * h * scaleFactor],
      [e + a * w * scaleFactor + c * h * scaleFactor, f + b * w * scaleFactor + d * h * scaleFactor]];
    const xs = corners.map(([x]) => x);
    const ys = corners.map(([, y]) => y);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(5 * scaleFactor - 0.01);
    expect(Math.max(...xs)).toBeLessThanOrEqual(75 * scaleFactor + 0.01);
    expect(Math.min(...ys)).toBeGreaterThanOrEqual(5 * scaleFactor - 0.01);
    expect(Math.max(...ys)).toBeLessThanOrEqual(175 * scaleFactor + 0.01);
    expect((Math.min(...xs) + Math.max(...xs)) / 2).toBeCloseTo(40 * scaleFactor, 4);
    expect((Math.min(...ys) + Math.max(...ys)) / 2).toBeCloseTo(90 * scaleFactor, 4);
  });

  it('keeps an empty timeline readable without fabricating paid installments', async () => {
    const [page] = pages(await createLoanPaymentPlanDocument({ ...loan, plan: [], validPayments: [] }, now));
    expect(page).toContain('No hay pagos recibidos.');
    expect(page).toContain('No hay cuotas pendientes.');
    expect(page).not.toContain('PAGO RECIBIDO');
    expect(page).toContain('¢0');
  });

  it('wraps long customer and identification values inside the 80mm page', async () => {
    const customerName = 'María Fernanda Rodríguez de la Cruz Ramírez del Valle '.repeat(3).trim();
    const document = await createLoanPaymentPlanDocument({ ...loan,
      customerName,
      identification: '101010101'.repeat(5), preferredPaymentMethod: 'Transferencia bancaria'.repeat(3),
    }, now);
    const [page] = pages(document);
    expect(page).toContain('CLIENTE');
    expect(page).toMatch(/\/F2 8 Tf[\s\S]*?\(CLIENTE\)/);
    document.setFont('helvetica', 'bold');
    document.setFontSize(9.5);
    for (const line of document.splitTextToSize(customerName, 72) as string[]) expect(page).toContain(line);
    expect(page).toMatch(/\/F2 9\.5 Tf[\s\S]*?\(María Fernanda/);
    expect(page).not.toContain('...');
    expect(page).toContain('SALDO ACTUAL');
    expect(page).toMatch(/\/F2 8\.5 Tf[\s\S]*?\(SALDO ACTUAL\)/);
    expect(page).toContain('Identificación:');
    expect(timelineRows(page)[0]).toEqual({ reference: 'PAGO RECIBIDO', date: '01/02/2026', state: 'PAGO RECIBIDO' });
    expect(document.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('prints every part of an exceptionally long name on bounded continuation pages', async () => {
    const words = Array.from({ length: 140 }, (_, index) => `Apellido${String(index).padStart(3, '0')}`);
    const document = await createLoanPaymentPlanDocument({ ...loan, customerName: words.join(' ') }, now);
    const sheets = pages(document);
    expect(sheets.length).toBeGreaterThan(2);
    expect(sheets[1]).toContain('CLIENTE');
    for (const word of words) expect(sheets.some((sheet) => sheet.includes(word))).toBe(true);
    expect(sheets.filter((sheet) => timelineRows(sheet).some(({ reference, state }) => reference === 'PAGO RECIBIDO' && state === 'PAGO RECIBIDO'))).toHaveLength(1);
    sheets.forEach((sheet) => { expect(sheet).toContain('Plan de pago'); expect(sheet).toContain('Generado:'); });
  });

  it.each([
    ['ACTIVE', 'ACTIVO', '700.00', false],
    ['CANCELLED', 'CANCELADO', '0.00', true],
    ['REFINANCED', 'REFINANCIADO', '700.00', true],
    ['UNCOLLECTIBLE', 'INCOBRABLE', '95.00', true],
    ['ANNULLED', 'ANULADO', '700.00', false],
  ])('renders %s with real balance and the appropriate watermark', async (status, label, balance, watermarked) => {
    const [page] = pages(await createLoanPaymentPlanDocument({ ...loan, status, financialBalance: balance }, now));
    expect(page).toContain(label);
    expect(page).toContain(balance === '0.00' ? '(¢0)' : balance === '95.00' ? '(¢95)' : '(¢700)');
    expect(/\/GS\d+ gs/.test(page)).toBe(watermarked);
    expect(page.includes('(CANCELADO) Tj')).toBe(status === 'CANCELLED');
  });

  it('repeats heading, watermark and page numbers without splitting payment rows on narrow pages', async () => {
    const many = { ...loan, status: 'CANCELLED', validPayments: [], plan: Array.from({ length: 52 }, (_, i) => ({
      id: `entry-${i}`, sequence: i + 3, dueDate: `2026-05-${String(i % 28 + 1).padStart(2, '0')}`, pendingAmount: '1.00',
    })), principal: '52.00', interestAmount: '0.00', totalAmount: '52.00', pendingTotal: '52.00', financialBalance: '52.00' };
    const document = await createLoanPaymentPlanDocument(many, now);
    const sheets = pages(document);
    expect(document.internal.pageSize.getWidth()).toBe(80);
    expect(document.internal.pageSize.getHeight()).toBe(180);
    expect(sheets.length).toBeGreaterThan(2);
    expect(sheets.length).toBeLessThan(7);
    sheets.forEach((sheet, index) => {
      expect(sheet).toContain('Plan de pago');
      expect(sheet).toContain('CANCELADO');
      expect(sheet).toMatch(/\/F2 30 Tf[\s\S]*?0\.137 0\.42 0\.271 rg/);
      expect(sheet).toContain(`${index + 1}/${sheets.length}`);
      expect(sheet).toContain('Generado:');
    });
    expect(sheets[0]).toContain('(Principal) Tj');
    sheets.slice(1).forEach((sheet) => {
      expect(sheet).toContain('(Cliente: María Fernanda Rodríguez de la Cruz) Tj');
      expect(sheet).not.toContain('(Principal) Tj');
      expect(sheet).not.toContain('(SALDO ACTUAL) Tj');
    });
    const all = sheets.join('\n');
    for (let sequence = 3; sequence <= 54; sequence += 1) {
      const row = new RegExp(`\\(CUOTA ${sequence} {2}\\d{2}/\\d{2}/2026 {2}\\) Tj[\\s\\S]*?\\(PENDIENTE\\) Tj[\\s\\S]*?\\(¢1\\) Tj`);
      expect(sheets.filter((sheet) => row.test(sheet))).toHaveLength(1);
    }
    expect(all).not.toContain('private-loan-uuid');
    expect(all).not.toMatch(/Cobrado|Por cobrar/);
  });

  it('fits a three-digit row and the longest CRC amount without clipping or splitting', async () => {
    const amount = '9999999999999999.99';
    const plan = Array.from({ length: 100 }, (_, index) => ({ id: `entry-${String(index).padStart(3, '0')}`, sequence: index + 1, dueDate: '2026-04-02', pendingAmount: '1.00' }));
    const document = await createLoanPaymentPlanDocument({ ...loan, validPayments: [], plan: [
      ...plan, { id: 'z-largest', sequence: 101, dueDate: '2026-04-02', pendingAmount: amount },
    ] }, now);
    const sheets = pages(document);
    const matches = sheets.map(textRuns).filter((runs) => runs.some(({ text }) => text === 'CUOTA 101  02/04/2026  '));
    expect(matches).toHaveLength(1);
    const runs = matches[0];
    const position = runs.findIndex(({ text }) => text === 'CUOTA 101  02/04/2026  ');
    const [prefix, state, money] = runs.slice(position, position + 3);
    expect([state.text, money.text]).toEqual(['PENDIENTE', getPdfMoneyText(amount)]);
    expect([state.y, money.y]).toEqual([prefix.y, prefix.y]);
    document.setFont('helvetica', 'bold'); document.setFontSize(state.size);
    const stateRight = state.x + document.getTextWidth(state.text) * document.internal.scaleFactor;
    document.setFont('helvetica', 'normal'); document.setFontSize(money.size);
    const moneyRight = money.x + document.getTextWidth(money.text) * document.internal.scaleFactor;
    expect(prefix.x).toBeGreaterThanOrEqual(4 * document.internal.scaleFactor - 0.1);
    expect(stateRight + 2 * document.internal.scaleFactor).toBeLessThanOrEqual(money.x + 0.1);
    expect(moneyRight).toBeLessThanOrEqual(76 * document.internal.scaleFactor + 0.1);
    expect(prefix.size).toBeGreaterThanOrEqual(4.5);
    expect(prefix.size).toBeLessThanOrEqual(7.5);
  });

  it('produces a real in-memory PDF with receipt rows and no auxiliary lines', async () => {
    const document = await createLoanPaymentPlanDocument(loan, now);
    const bytes = new Uint8Array(document.output('arraybuffer'));
    const pdf = new TextDecoder('latin1').decode(bytes);
    expect(bytes.byteLength).toBeGreaterThan(1000);
    expect(pdf.startsWith('%PDF-')).toBe(true);
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(pdf).toContain('(PAGO RECIBIDO) Tj');
    expect(pdf).toContain('(PAGOS RECIBIDOS) Tj');
    expect(pdf).toContain('(CUOTAS PENDIENTES) Tj');
    expect(pdf).not.toMatch(/Aplicado a cuota|aplicaciones históricas/);
    expect(pdf).not.toMatch(/Cobrado|Por cobrar/);
  });

  it('keeps the PDF blob URL available until the preview tab closes', async () => {
    const preview = { closed: false };
    const open = vi.fn(() => preview);
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    const revokeObjectURL = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    let checkClosed: () => void = () => undefined;
    const setInterval = vi.fn((callback: () => void) => { checkClosed = callback; return 17; });
    const clearInterval = vi.fn();
    vi.stubGlobal('window', { open, setInterval, clearInterval });
    try {
      await generateLoanPaymentPlanReport(loan);
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect((createObjectURL.mock.calls[0][0] as Blob).type).toBe('application/pdf');
      expect(open).toHaveBeenCalledWith('blob:preview', '_blank');
      expect(revokeObjectURL).not.toHaveBeenCalled();
      checkClosed();
      expect(revokeObjectURL).not.toHaveBeenCalled();
      preview.closed = true;
      checkClosed();
      expect(clearInterval).toHaveBeenCalledWith(17);
      expect(revokeObjectURL).toHaveBeenCalledExactlyOnceWith('blob:preview');
    } finally { createObjectURL.mockRestore(); revokeObjectURL.mockRestore(); vi.unstubAllGlobals(); }
  });
});
