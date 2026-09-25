import type { FinancialOpeningInput, FinancialOpeningRepository } from '../ports/financial-opening.repository';
export class GetFinancialOpening { constructor(private readonly repository: FinancialOpeningRepository) {} execute() { return this.repository.get(); } }
export class PerformFinancialOpening { constructor(private readonly repository: FinancialOpeningRepository) {} execute(input: FinancialOpeningInput) { return this.repository.perform(input); } }
