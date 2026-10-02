import { LoanAnnulmentController } from '../application/use-cases/loan-annulment-controller';
import { loanApi } from '../infrastructure/api/loan.api';

export const createLoanAnnulment = (canAnnul: () => boolean) => new LoanAnnulmentController(loanApi, () => crypto.randomUUID(), canAnnul);
