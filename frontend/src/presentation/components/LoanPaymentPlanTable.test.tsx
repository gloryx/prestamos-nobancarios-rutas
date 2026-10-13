import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { LoanPaymentPlanTable } from './LoanPaymentPlanTable';

describe('LoanPaymentPlanTable payment semantics', () => {
  it('shows one consecutive current sequence and never treats a moved zero balance as paid', () => {
    const html = renderToStaticMarkup(<LoanPaymentPlanTable showCondition hideReprogrammed total="20.00" plan={[
      { id: 'entry-15', sequence: 15, dueDate: '2026-10-08', pendingAmount: '0.00' },
      { id: 'entry-16', sequence: 16, dueDate: '2026-10-09', pendingAmount: '0.00' },
      { id: 'entry-17', sequence: 17, dueDate: '2099-10-10', pendingAmount: '20.00' },
    ]} paymentApplications={[
      { planEntryId: 'entry-15', sequence: 15, amountApplied: '20.00', pendingAfter: '0.00' },
      { planEntryId: 'entry-16', sequence: 16, amountApplied: '5.00', pendingAfter: '15.00' },
    ]} />);
    expect(html).toMatch(/<td>1<\/td>[\s\S]*?>PAGADA<\/span>/);
    expect(html).toMatch(/<td>2<\/td>[\s\S]*?>PENDIENTE<\/span>/);
    expect(html).not.toContain('REPROGRAMADA');
    expect(html).not.toContain('<td>15</td>');
  });
});
