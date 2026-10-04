import { useEffect, useRef, useState, type ReactElement } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import type { RefinancingResult } from '../../domain/entities/loan-refinancing';
import { loanRefinancingOperations } from '../../infrastructure/api/loan-refinancing.api';
import { HttpApiError } from '../../infrastructure/api/api-client';
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
  useEffect(() => {
    let active = true;
    void loanRefinancingOperations.detail(id).then((value) => { if (active) setResult({ id, value }); })
      .catch((cause) => { if (active) setError({ id, cause }); });
    return () => { active = false; };
  }, [id, request]);
  const visible = result?.id === id ? result.value : created?.refinancingId === id ? created : null;
  useEffect(() => { if (visible) headingRef.current?.focus(); }, [visible]);
  if (visible) return <RefinancingResultView result={visible} headingRef={headingRef}
    onNew={created?.refinancingId === id ? () => navigate('/loan-refinancings/new') : undefined} />;
  if (error?.id === id) return <section className="page-section loan-wizard" role="alert">
    <p>{error.cause instanceof HttpApiError && error.cause.status === 404 ? 'El refinanciamiento no está disponible.' :
      error.cause instanceof HttpApiError && error.cause.status === 403 ? 'No tienes permiso para consultar refinanciamientos.' :
        'No se pudo consultar el refinanciamiento. Intenta nuevamente.'}</p>
    <button className="button button--secondary" type="button" onClick={() => { setError(null); setRequest((value) => value + 1); }}>Reintentar</button>
  </section>;
  return <p className="page-section" role="status">Cargando refinanciamiento…</p>;
}
