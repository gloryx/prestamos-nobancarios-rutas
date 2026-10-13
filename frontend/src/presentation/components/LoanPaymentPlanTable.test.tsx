import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoanPaymentPlanTable } from './LoanPaymentPlanTable';

describe('LoanPaymentPlanTable payment semantics', () => {
  it('uses contractual sequences and never treats a personalized zero balance as a paid installment', () => {
    const html = renderToStaticMarkup(<LoanPaymentPlanTable showCondition total="20.00" plan={[
      { id: 'entry-15', sequence: 15, dueDate: '2026-10-08', pendingAmount: '0.00' },
      { id: 'entry-16', sequence: 16, dueDate: '2026-10-09', pendingAmount: '0.00' },
      { id: 'entry-17', sequence: 17, dueDate: '2099-10-10', pendingAmount: '20.00' },
    ]} paymentApplications={[{ planEntryId: 'entry-15', sequence: 15, amountApplied: '20.00' }]} />);
    expect(html).toMatch(/<td>15<\/td>[\s\S]*?>PAGADA<\/span>/);
    expect(html).toMatch(/<td>16<\/td>[\s\S]*?>REPROGRAMADA<\/span>/);
    expect(html).toMatch(/<td>17<\/td>[\s\S]*?>PENDIENTE<\/span>/);
    expect(html).not.toMatch(/<td>16<\/td>[\s\S]*?>PAGADA<\/span>/);
  });
});
