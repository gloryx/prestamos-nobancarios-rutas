import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { RefinancingResult } from '../../domain/entities/loan-refinancing';
import { loanApi } from '../../infrastructure/api/loan.api';
import { loanRefinancingOperations } from '../../infrastructure/api/loan-refinancing.api';
import { HttpApiError } from '../../infrastructure/api/api-client';
import { generateLoanPaymentPlanReport } from '../../infrastructure/reports/loan-payment-plan-report.service';
import { RefinancingResultView } from './RefinancingResultView';

export function RefinancingDetailPage(): ReactElement {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const created = (location.state as { createdRefinancing?: RefinancingResult } | null)?.createdRefinancing;
  const headingRef = useRef<HTMLHeadingElement>(null);
  const [request, setRequest] = useState(0);
  const [result, setResult] = useState<{ id: string; value: RefinancingResult } | null>(null);
  const [error, setError] = useState<{ id: string; cause: unknown } | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState('');
  useEffect(() => {
    let active = true;
    void loanRefinancingOperations.detail(id).then((value) => { if (active) setResult({ id, value }); })
      .catch((cause) => { if (active) setError({ id, cause }); });
    return () => { active = false; };
  }, [id, request]);
  const visible = result?.id === id ? result.value : created?.refinancingId === id ? created : null;
  useEffect(() => { if (visible) headingRef.current?.focus(); }, [visible]);
  const download = async (refinancing: RefinancingResult) => {
    if (downloading) return;
    setDownloading(true); setDownloadError('');
    try { await generateLoanPaymentPlanReport(await loanApi.detail(refinancing.originLoan.id)); }
    catch { setDownloadError('No se pudo descargar el plan de pagos. Intenta nuevamente.'); }
    finally { setDownloading(false); }
  };
  if (visible) return <RefinancingResultView result={visible} headingRef={headingRef}
    onNew={created?.refinancingId === id ? () => navigate('/loan-refinancings/new') : undefined}
    onDownload={() => { void download(visible); }} downloading={downloading} downloadError={downloadError} />;
  if (error?.id === id) return <section className="page-section loan-wizard" role="alert">
    <p>{error.cause instanceof HttpApiError && error.cause.status === 404 ? 'El refinanciamiento no está disponible.' :
      error.cause instanceof HttpApiError && error.cause.status === 403 ? 'No tienes permiso para consultar refinanciamientos.' :
        'No se pudo consultar el refinanciamiento. Intenta nuevamente.'}</p>
    <button className="button button--secondary" type="button" onClick={() => { setError(null); setRequest((value) => value + 1); }}>Reintentar</button>
  </section>;
  return <p className="page-section" role="status">Cargando refinanciamiento…</p>;
}
