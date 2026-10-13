import type { CollectorPrecollectionDetail } from '../../domain/entities/collector-precollection';
import type { CollectorSettlementStatus } from '../../domain/entities/collector-settlement';

export type SettlementAction = 'submit' | 'review' | 'reject' | 'cancel' | 'confirm';
export type CustodyOperation = 'remit' | 'topUp' | 'adjust';

export function precollectionActions(item: CollectorPrecollectionDetail, canCancel: boolean, onDetail: (item: CollectorPrecollectionDetail) => void, onCancel: (item: CollectorPrecollectionDetail) => void) {
  return [{ key: 'view', icon: 'view' as const, label: 'Ver', title: 'Ver detalle', ariaLabel: `Ver cobro de ${item.customerName}`, onClick: () => onDetail(item) }, ...(canCancel && item.status === 'RECORDED' ? [{ key: 'cancel', icon: 'delete' as const, label: 'Cancelar', title: 'Cancelar cobro', ariaLabel: `Cancelar cobro de ${item.customerName}`, onClick: () => onCancel(item) }] : [])];
}

export function settlementActionsFor(status: CollectorSettlementStatus, mine: boolean, can: (permission: string) => boolean): SettlementAction[] {
  return mine ? [...(status === 'DRAFT' && can('collector-settlements.self.submit') ? ['submit' as const] : []), ...(status === 'DRAFT' && can('collector-settlements.self.cancel') ? ['cancel' as const] : [])] : [...(status === 'SUBMITTED' && can('collector-settlements.review') ? ['review' as const] : []), ...(status === 'UNDER_REVIEW' && can('collector-settlements.confirm') ? ['confirm' as const] : []), ...(status === 'UNDER_REVIEW' && can('collector-settlements.reject') ? ['reject' as const] : []), ...(['DRAFT', 'SUBMITTED'].includes(status) && can('collector-settlements.cancel') ? ['cancel' as const] : [])];
}

export function custodyOperationsFor(mine: boolean, can: (permission: string) => boolean): Array<{ operation: CustodyOperation; code: string; label: string }> {
  const definitions: Array<{ operation: CustodyOperation; code: string; label: string }> = mine ? [{ operation: 'remit', code: 'collector-custody.self.remit', label: 'Registrar mi remesa' }] : [{ operation: 'remit', code: 'collector-custody.remit', label: 'Registrar remesa' }, { operation: 'topUp', code: 'collector-custody.topup', label: 'Registrar aporte' }, { operation: 'adjust', code: 'collector-custody.adjust', label: 'Registrar ajuste' }];
  return definitions.filter((entry) => can(entry.code));
}
