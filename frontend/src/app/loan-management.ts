import { LoanManagementController, type LoanOperation } from '../application/use-cases/loan-management-controller';
import { loanApi } from '../infrastructure/api/loan.api';

export const createLoanManagement = (canAttempt: (operation: LoanOperation) => boolean) =>
  new LoanManagementController(loanApi, () => crypto.randomUUID(), canAttempt);
