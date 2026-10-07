import { CustomerAgendaController } from '../application/use-cases/customer-agenda-controller';
import { customerAgendaApi } from '../infrastructure/api/customer-agenda.api';

export const createCustomerAgenda = () => new CustomerAgendaController(customerAgendaApi);
