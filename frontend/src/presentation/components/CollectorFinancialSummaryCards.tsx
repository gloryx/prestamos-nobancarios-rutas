import type { ReactElement } from 'react';
import type { CollectorFinancialSummary } from '../../domain/entities/collector';
import { formatCRCAggregate } from '../../shared/utils/money';

export function CollectorFinancialSummaryCards({ summary }: { summary: CollectorFinancialSummary }): ReactElement {
  const metrics = [
    { label: 'TOTAL COLOCADO', value: formatCRCAggregate(summary.totalPlaced) },
    { label: 'TOTAL PENDIENTE', value: formatCRCAggregate(summary.totalOutstanding) },
    { label: 'GANANCIA REALIZADA', value: formatCRCAggregate(summary.realizedGain) },
    { label: 'PRÉSTAMOS ACTIVOS', value: String(summary.activeLoansCount) },
  ];
  return <section className="collector-summary__section" aria-label="Indicadores de cartera activa">
    <div className="collector-summary__metrics">{metrics.map((metric) => <article key={metric.label}><strong>{metric.value}</strong><span>{metric.label}</span></article>)}</div>
  </section>;
}
