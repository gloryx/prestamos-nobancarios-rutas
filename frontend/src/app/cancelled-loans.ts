import { ListCancelledLoans } from '../application/use-cases/cancelled-loans';
import { loanApi } from '../infrastructure/api/loan.api';

export const cancelledLoans = new ListCancelledLoans({ list: (query) => loanApi.cancelled(query) });
