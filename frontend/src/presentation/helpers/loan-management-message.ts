const messages: Record<string, string> = {
  'Unable to complete the request.': 'No se pudo completar la solicitud.',
  'Loan page changed during refresh. Try again.': 'La página cambió durante la actualización. Intente nuevamente.',
  'A reason is required.': 'Indique el motivo.',
  'The transition was received, but the loan list could not be refreshed.': 'El cambio de estado se recibió, pero no se pudo actualizar el listado de préstamos.',
};

export const loanManagementMessage = (message: string): string => messages[message] ?? message;
