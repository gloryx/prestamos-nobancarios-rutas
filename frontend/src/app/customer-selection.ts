import { CustomerSelectionController } from '../application/use-cases/customer-selection-controller';
import { customerUseCases } from './customers';

export function createCustomerSelection(): CustomerSelectionController {
  return new CustomerSelectionController({
    list: (query) => customerUseCases.list.execute(query),
  });
}
