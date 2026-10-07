import { useEffect, useState, type ReactElement } from 'react';
import { Link } from 'react-router-dom';
import { collectorUseCases } from '../../app/collectors';
import type { CollectorFinancialSummary } from '../../domain/entities/collector';
import { CollectorFinancialSummaryCards } from '../components/CollectorFinancialSummaryCards';
import { useAuth } from '../hooks/auth-context';

export function CollectorFinancialSummaryPage(): ReactElement {
  const { can } = useAuth();
  const [summary, setSummary] = useState<CollectorFinancialSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    void collectorUseCases.financialSummary.execute()
      .then((value) => { if (active) { setSummary(value); setError(''); } })
      .catch((cause: unknown) => { if (active) setError(cause instanceof Error ? cause.message : 'No se pudo cargar tu resumen financiero.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  return <CollectorFinancialSummaryView summary={summary} loading={loading} error={error} can={can} />;
}

export function CollectorFinancialSummaryView({ summary, loading, error, can }: {
  summary?: CollectorFinancialSummary; loading: boolean; error: string; can: (permission: string) => boolean;
}): ReactElement {
  return <section className="page-section collector-summary" aria-labelledby="collector-summary-title">
    <header className="loan-list__heading"><div><span className="eyebrow">COBRADOR</span><h1 id="collector-summary-title">Mi resumen financiero</h1><p>Vista operativa de tu cartera actualmente asignada.</p></div></header>
    {loading && <div className="collector-summary__message" aria-live="polite">Cargando resumen financiero…</div>}
    {error && <div className="collector-summary__message collector-summary__message--error" role="alert">{error}</div>}
    {!loading && !error && summary && <>
      <CollectorFinancialSummaryCards summary={summary} />
      <nav className="collector-summary__actions" aria-label="Accesos operativos">
        {can('daily-collections.assigned.view') && <Link className="button button--primary" to="/collector/daily-collections">Ver cobros del día</Link>}
        {can('collection-agenda.view') && <Link className="button button--secondary" to="/collectors/collection-agenda">Ver agenda de cobros</Link>}
      </nav>
    </>}
  </section>;
}
