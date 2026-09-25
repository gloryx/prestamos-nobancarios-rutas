import { CreateCashMovement, ListCashMovements, ReverseCashMovement, SummarizeCashMovements } from '../application/use-cases/cash-movement.use-cases';
import { CashMovementApi } from '../infrastructure/api/cash-movement.api';
const repository = new CashMovementApi();
export const cashMovementUseCases = { list: new ListCashMovements(repository), summary: new SummarizeCashMovements(repository), create: new CreateCashMovement(repository), reverse: new ReverseCashMovement(repository) };
