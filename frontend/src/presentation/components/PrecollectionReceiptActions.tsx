import { useState, type ReactElement } from 'react';
import { collectorPrecollections } from '../../app/collector-precollections';
import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import {
  canIssuePrecollectionReceipt,
  createPrecollectionReceiptPdf,
  downloadPrecollectionReceipt,
  precollectionPhoneOptions,
  sharePrecollectionReceiptDocument,
} from '../../infrastructure/reports/collector-precollection-receipt.service';
import { precollectionStatusLabel } from '../helpers/stage3b';

export function PrecollectionReceiptActions({ item }: { item: CollectorPrecollectionDetail }): ReactElement {
  const [candidate, setCandidate] = useState<CollectorPrecollectionDetail>();
  const [busy, setBusy] = useState<'download' | 'prepare' | 'share' | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [selectedPhone, setSelectedPhone] = useState('');

  if (!canIssuePrecollectionReceipt(item)) {
    return <p className="stage3b__message">No hay un comprobante vigente para este cobro.</p>;
  }

  const current = async () => collectorPrecollections.detail(item.id);
  const download = async () => {
    if (busy) return;
    setBusy('download'); setError(''); setMessage('');
    try { downloadPrecollectionReceipt(await createPrecollectionReceiptPdf(await current()));
      setMessage('El comprobante actualizado se descargó en este dispositivo.'); }
    catch { setError('No se pudo generar el comprobante actualizado.'); }
    finally { setBusy(null); }
  };
  const prepareShare = async () => {
    if (busy) return;
    setBusy('prepare'); setError(''); setMessage('');
    try {
      const fresh = await current();
      setCandidate(fresh);
      setSelectedPhone(precollectionPhoneOptions(fresh)[0]?.display ?? '');
    } catch { setError('No se pudo verificar el comprobante ni su destinatario.'); }
    finally { setBusy(null); }
  };
  const share = async () => {
    if (!candidate || busy) return;
    setBusy('share'); setError(''); setMessage('');
    try {
      const fresh = await current();
      const currentPhones = precollectionPhoneOptions(fresh);
      if (fresh.customerName !== candidate.customerName || fresh.customerPhone !== candidate.customerPhone
        || fresh.customerSecondaryPhone !== candidate.customerSecondaryPhone || fresh.status !== candidate.status
        || (selectedPhone && !currentPhones.some((option) => option.display === selectedPhone))) {
        setCandidate(fresh);
        setSelectedPhone(currentPhones[0]?.display ?? '');
        setError('El destinatario o el estado cambió. Verificá nuevamente antes de compartir.');
        return;
      }
      const result = await sharePrecollectionReceiptDocument(await createPrecollectionReceiptPdf(fresh), fresh, selectedPhone || undefined);
      setCandidate(undefined);
      setMessage(result === 'NATIVE_SHARE_COMPLETED' ? 'Se cerró el selector del teléfono; verificá el destinatario y el envío en la aplicación elegida.'
        : result === 'DOWNLOADED_AND_WHATSAPP_OPENED' ? 'Se descargó el PDF y se abrió un mensaje de WhatsApp sin enviarlo.'
        : 'Se descargó el PDF. El teléfono del cliente no permite abrir un destinatario de WhatsApp válido.');
    } catch (cause) {
      if ((cause as { name?: string }).name !== 'AbortError') setError('No se pudo preparar el comprobante para compartir.');
    } finally { setBusy(null); }
  };

  return <div className="precollection-receipt-actions">
    <div className="precollection-receipt-actions__buttons">
      <button className="button button--secondary" type="button" disabled={Boolean(busy)} onClick={() => void download()}>{busy === 'download' ? 'Generando…' : 'Descargar comprobante'}</button>
      <button className="button button--primary" type="button" disabled={Boolean(busy)} onClick={() => void prepareShare()}>{busy === 'prepare' ? 'Verificando…' : 'Compartir comprobante'}</button>
    </div>
    {message && <p className="precollection-receipt-actions__message" role="status">{message}</p>}
    {error && <p className="form-error" role="alert">{error}</p>}
    {candidate && <div className="dialog-backdrop"><div className="dialog precollection-share-dialog" role="dialog" aria-modal="true" aria-labelledby="precollection-share-title">
      <h3 id="precollection-share-title">Verificar destinatario</h3>
      <dl className="stage3b__detail"><dt>Cliente</dt><dd>{candidate.customerName}</dd><dt>Estado actual</dt><dd>{precollectionStatusLabel[candidate.status]}</dd></dl>
      {precollectionPhoneOptions(candidate).length > 0 ? <fieldset className="precollection-share-dialog__phones"><legend>Elegí y confirmá el teléfono</legend>{precollectionPhoneOptions(candidate).map((option) => <label key={option.kind}><input type="radio" name="receipt-phone" value={option.display} checked={selectedPhone === option.display} onChange={() => setSelectedPhone(option.display)} /><span><strong>{option.label}</strong>{option.display}</span></label>)}</fieldset>
        : <p className="stage3b__warning">El cliente no tiene un teléfono válido para precargar WhatsApp. Todavía podés usar el selector nativo o descargar el PDF.</p>}
      <p>El PDF no se enviará automáticamente. Si se abre WhatsApp sin el archivo adjunto, agregá manualmente el PDF descargado antes de enviar.</p>
      <div className="dialog-actions"><button className="button button--secondary" type="button" disabled={busy === 'share'} onClick={() => setCandidate(undefined)}>Cancelar</button><button className="button button--primary" type="button" disabled={busy === 'share'} onClick={() => void share()}>{busy === 'share' ? 'Preparando…' : 'Continuar para compartir'}</button></div>
    </div></div>}
  </div>;
}
