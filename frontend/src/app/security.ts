import { SecurityApi } from '../infrastructure/api/security.api';
import { securityUseCases } from '../application/use-cases/security.use-cases';
export const securityApi = new SecurityApi();
export const security = securityUseCases(securityApi);
