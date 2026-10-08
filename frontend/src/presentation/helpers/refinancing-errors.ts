import type { RefinancingFailure } from '../../application/use-cases/refinancing-confirmation-controller';

const errorMessages: Record<RefinancingFailure, string> = {
  STALE_DATA: 'El préstamo cambió desde que se preparó el refinanciamiento. Actualizamos la información para que pueda revisarla nuevamente.',
  ALREADY_REFINANCED: 'Este préstamo ya fue refinanciado y no puede volver a utilizarse como préstamo origen.',
  IDEMPOTENCY_CONFLICT: 'La solicitud de confirmación entró en conflicto. Regresa y revisa las condiciones antes de intentarlo de nuevo.',
  CONCURRENT_REFINANCING: 'Otra operación modificó el préstamo. Actualizamos la información para que puedas revisarla nuevamente.',
  HISTORICAL_BALANCE_CONFLICT: 'No se puede confirmar porque el saldo histórico de la fecha seleccionada no coincide con el plan. Regresa y revisa la fecha y los importes.',
  CONFLICT: 'No se pudo confirmar porque cambió el estado del préstamo. Revisa las condiciones antes de intentarlo de nuevo.',
  INVALID: 'El plan o alguna condición no es válida. Regresa y revisa los datos ingresados.',
  FORBIDDEN: 'No tienes permiso para confirmar refinanciamientos.',
  NOT_FOUND: 'El préstamo origen ya no está disponible. Vuelve a la búsqueda para elegir otro.',
  NETWORK: 'No se pudo confirmar la respuesta del servidor. Reintenta sin cambiar los datos; se conservará la misma solicitud.',
  SERVER: 'No se pudo confirmar la respuesta del servidor. Reintenta sin cambiar los datos; se conservará la misma solicitud.',
};

export function refinancingFailureMessage(failure: RefinancingFailure): string { return errorMessages[failure]; }
