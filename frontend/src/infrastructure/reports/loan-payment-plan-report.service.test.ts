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
  validPayments: [
    { id: 'payment-b', paymentDate: '2026-02-01', amount: '100.00', status: 'VALID' },
    { id: 'payment-a', paymentDate: '2026-02-01', amount: '400.00', status: 'VALID' },
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
const timelineRows = (page: string) => [...page.matchAll(/\((\d+)\. {2}(\d{2}\/\d{2}\/\d{4}) {2}\) Tj[\s\S]*?\((PAGADO|PENDIENTE|VENCIDO)\) Tj/g)]
  .map(([, number, date, state]) => ({ number: Number(number), date, state }));
const textRuns = (page: string) => [...page.matchAll(/BT\n\/F\d+ ([\d.]+) Tf[\s\S]*?([\d.]+) ([\d.]+) Td\n\(([^)]*)\) Tj\nET/g)]
  .map(([, size, x, y, text]) => ({ size: Number(size), x: Number(x), y: Number(y), text }));

describe('existing shared loan payment-plan receipt', () => {
  it('prints actual payments before same-day obligations with visual numbering and no zero or annulled rows', async () => {
    const [page] = pages(await createLoanPaymentPlanDocument(loan, now));
    expect(timelineRows(page)).toEqual([
      { number: 1, date: '01/02/2026', state: 'PAGADO' },
      { number: 2, date: '01/02/2026', state: 'PAGADO' },
      { number: 3, date: '01/02/2026', state: 'VENCIDO' },
      { number: 4, date: '02/04/2026', state: 'PENDIENTE' },
    ]);
    expect(page).not.toContain('5.  01/03/2026');
    expect(page).not.toContain('900,00');
    expect(page).toContain('700,00');
    expect(page).toContain('500,00');
    expect(page).not.toContain('private-loan-uuid');
    expect(page).toContain('02/04/2026 14:05');
    expect(page).toContain('1/1');
    expect(page).not.toMatch(/Cobrado|Por cobrar/);
  });

  it('colors only paid and pending state tokens, aligns them to the black date and resets ink', async () => {
    const document = await createLoanPaymentPlanDocument(loan, now);
    const [page] = pages(document);
    const paid = page.match(/0\. g\n0\. Tc\n([\d.]+) ([\d.]+) Td\n\(1\. {2}01\/02\/2026 {2}\) Tj\nET\nBT\n\/F2 7\.5 Tf\n8\.625 TL\n0\.094 0\.388 0\.216 rg\n0\. Tc\n([\d.]+) ([\d.]+) Td\n\(PAGADO\) Tj/);
    expect(paid).not.toBeNull();
    document.setFont('helvetica', 'bold');
    document.setFontSize(7.5);
    expect(Number(paid![3]) - Number(paid![1])).toBeCloseTo(document.getTextWidth('1.  01/02/2026  ') * document.internal.scaleFactor, 4);
    expect(paid![4]).toBe(paid![2]);
    const amount = page.match(/\(PAGADO\) Tj\nET\nBT\n\/F1 7\.5 Tf\n8\.625 TL\n0\. g\n0\. Tc\n([\d.]+) ([\d.]+) Td\n\(¢400,00\) Tj/);
    expect(amount?.[2]).toBe(paid![4]);
    expect(page).toMatch(/0\.569 0\.176 0\.176 rg[\s\S]*?\(PENDIENTE\) Tj\nET\nBT[\s\S]*?0\. g[\s\S]*?\(¢400,00\) Tj/);
    expect(page).toMatch(/\/F2 7\.5 Tf\n8\.625 TL\n0\. g\n0\. Tc\n[\d.]+ [\d.]+ Td\n\(VENCIDO\) Tj/);
    expect(page).toMatch(/0\. g\n0\. Tc\n[\d.]+ [\d.]+ Td\n\(¢400,00\) Tj/);
  });

  it.each([['50.00', '1150.00'], ['350.00', '850.00']])('shows the full %s payment rather than the scheduled installment', async (amount, balance) => {
    const fixture = { ...loan, financialBalance: balance, validPayments: [{ id: 'payment', paymentDate: '2026-02-01', amount, status: 'VALID' as const }],
      plan: [{ id: 'plan', sequence: 3, dueDate: '2026-02-01', pendingAmount: '300.00' }] };
    const [page] = pages(await createLoanPaymentPlanDocument(fixture, now));
    expect(timelineRows(page).map(({ state }) => state)).toEqual(['PAGADO', 'VENCIDO']);
    expect(page).toContain(getPdfMoneyText(amount));
    expect(page).toContain(getPdfMoneyText('300.00'));
    expect(page).toContain(getPdfMoneyText(balance));
  });

  it('keeps the real positive balance even when a loan is marked cancelled', async () => {
    const [page] = pages(await createLoanPaymentPlanDocument({ ...loan, status: 'CANCELLED', financialBalance: '700.00' }, now));
    expect(page).toContain('CANCELADO');
    expect(page).toContain('¢700,00');
  });

  it('keeps an empty timeline readable without fabricating paid installments', async () => {
    const [page] = pages(await createLoanPaymentPlanDocument({ ...loan, plan: [], validPayments: [] }, now));
    expect(page).toContain('Sin pagos');
    expect(page).not.toContain('PAGADO');
    expect(page).toContain('¢0,00');
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
    expect(timelineRows(page)[0]).toEqual({ number: 1, date: '01/02/2026', state: 'PAGADO' });
    expect(document.getNumberOfPages()).toBeGreaterThanOrEqual(1);
  });

  it('prints every part of an exceptionally long name on bounded continuation pages', async () => {
    const words = Array.from({ length: 140 }, (_, index) => `Apellido${String(index).padStart(3, '0')}`);
    const document = await createLoanPaymentPlanDocument({ ...loan, customerName: words.join(' ') }, now);
    const sheets = pages(document);
    expect(sheets.length).toBeGreaterThan(2);
    expect(sheets[1]).toContain('CLIENTE');
    for (const word of words) expect(sheets.some((sheet) => sheet.includes(word))).toBe(true);
    expect(sheets.filter((sheet) => timelineRows(sheet).some(({ number, state }) => number === 1 && state === 'PAGADO'))).toHaveLength(1);
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
    expect(page).toContain(balance === '0.00' ? '0,00' : balance === '95.00' ? '95,00' : '700,00');
    expect(/\/GS\d+ gs/.test(page)).toBe(watermarked);
  });

  it('repeats heading, watermark and page numbers without splitting payment rows on narrow pages', async () => {
    const many = { ...loan, status: 'REFINANCED', validPayments: [], plan: Array.from({ length: 52 }, (_, i) => ({
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
      expect(sheet).toContain('REFINANCIADO');
      expect(sheet).toContain(`${index + 1}/${sheets.length}`);
      expect(sheet).toContain('Generado:');
    });
    const all = sheets.join('\n');
    for (let number = 1; number <= 52; number += 1) {
      const row = new RegExp(`\\(${number}\\. {2}\\d{2}/\\d{2}/2026 {2}\\) Tj[\\s\\S]*?\\(PENDIENTE\\) Tj[\\s\\S]*?\\(¢1,00\\) Tj`);
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
    const matches = sheets.map(textRuns).filter((runs) => runs.some(({ text }) => text === '101.  02/04/2026  '));
    expect(matches).toHaveLength(1);
    const runs = matches[0];
    const position = runs.findIndex(({ text }) => text === '101.  02/04/2026  ');
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
    expect(pdf).toContain('(PAGADO) Tj');
    expect(pdf).not.toMatch(/Cobrado|Por cobrar/);
  });

  it('keeps blob preview in a new tab rather than downloading the receipt', async () => {
    const open = vi.fn(() => ({ addEventListener: vi.fn() }));
    const createObjectURL = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:preview');
    vi.stubGlobal('window', { open, setTimeout: vi.fn() });
    try {
      await generateLoanPaymentPlanReport(loan);
      expect(createObjectURL).toHaveBeenCalledOnce();
      expect(open).toHaveBeenCalledWith('blob:preview', '_blank');
    } finally { createObjectURL.mockRestore(); vi.unstubAllGlobals(); }
  });
});
