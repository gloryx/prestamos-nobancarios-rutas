import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { PaymentCollectorReportController, type PaymentCollectorReportState } from '../../application/use-cases/payment-collector-report-controller';
import type { PaymentCollectorReportResult } from '../../domain/entities/payment-collector-report';
import { PaymentCollectorReportView } from './PaymentCollectorReportPage';

const data: PaymentCollectorReportResult = { filters: { fromDate: '2026-10-01', toDate: '2026-10-31' },
  summary: { paymentsCount: 3, totalReceived: '150000.00', principalApplied: '120000.00', interestApplied: '30000.00' },
  collectors: [{ collectorId: 'collector-1', collectorName: 'Ana Mora', collectorActive: false, paymentsCount: 3,
    customersCount: 2, loansCount: 2, totalReceived: '150000.00', principalApplied: '120000.00', interestApplied: '30000.00',
    averagePayment: '50000.00', participationPercentage: '100.00' }], options: { collectors: [{ id: 'collector-1', name: 'Ana Mora', active: false }],
    paymentMethods: [{ id: 'method-1', name: 'Efectivo', active: true }] } };
const controller = new PaymentCollectorReportController({ load: async () => data }, () => '2026-10-31');
const render = (state: PaymentCollectorReportState) => renderToStaticMarkup(<PaymentCollectorReportView state={state}
  controller={controller} exporting={false} exportError="" onExport={() => {}} />);

describe('PaymentCollectorReportView', () => {
  it('renders filters, authoritative totals, both charts and the full comparative table', () => {
    const html = render({ filters: { fromDate: '2026-10-01', toDate: '2026-10-31', collectorId: '', paymentMethodId: '' },
      data, options: data.options, loading: false, error: '' });
    for (const fragment of ['Cobros por cobrador', 'Aplicar filtros', 'Exportar PDF', 'PAGOS', '>3<', '₡150.000,00',
      'CAPITAL APLICADO', '₡120.000,00', 'INTERÉS APLICADO', '₡30.000,00', 'Total por cobrador', 'Composición del total',
      'Ana Mora', 'Inactivo', '₡50.000,00', '100.00%']) expect(html).toContain(fragment);
    expect(html).toContain('Capital 80.0%, interés 20.0%');
  });

  it('distinguishes loading, errors and empty periods', () => {
    const filters = { fromDate: '2026-10-01', toDate: '2026-10-31', collectorId: '', paymentMethodId: '' };
    expect(render({ filters, data: null, options: null, loading: true, error: '' })).toContain('Cargando reporte');
    expect(render({ filters, data: null, options: null, loading: false, error: 'Fallo controlado' })).toContain('Fallo controlado');
    expect(render({ filters, data: { ...data, collectors: [], summary: { paymentsCount: 0, totalReceived: '0.00', principalApplied: '0.00', interestApplied: '0.00' } },
      options: data.options, loading: false, error: '' })).toContain('No hay cobros atribuidos');
  });
});
