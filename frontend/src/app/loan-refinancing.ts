import { RefinancingStepOneController } from '../application/use-cases/refinancing-step-one-controller';
import { RefinancingConditionsController } from '../application/use-cases/refinancing-conditions-controller';
import { RefinancingConfirmationController } from '../application/use-cases/refinancing-confirmation-controller';
import { RefinancingListController } from '../application/use-cases/refinancing-list-controller';
import { RefinancingChainController } from '../application/use-cases/refinancing-chain-controller';
import { classifyRefinancingFailure, loanRefinancingApi, loanRefinancingChainsApi, loanRefinancingListApi, loanRefinancingOperations, loanRefinancingOptions, refinancingCustomerLookup } from '../infrastructure/api/loan-refinancing.api';

export const createRefinancingStepOne = () => new RefinancingStepOneController(loanRefinancingApi);
export const createRefinancingConditions = () => new RefinancingConditionsController(loanRefinancingOptions);
export const createRefinancingList = () => new RefinancingListController(loanRefinancingListApi, refinancingCustomerLookup);
export const createRefinancingChains = () => new RefinancingChainController(loanRefinancingChainsApi, refinancingCustomerLookup);
export const createRefinancingConfirmation = () => new RefinancingConfirmationController(
  loanRefinancingOperations, () => crypto.randomUUID(), classifyRefinancingFailure);
