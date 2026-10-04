import { Transform } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Min } from 'class-validator';
import type { LoanStatus } from '../../domain/loan/loan.types';
const LOAN_STATUSES: LoanStatus[] = ['ACTIVE', 'CANCELLED', 'REFINANCED', 'UNCOLLECTIBLE', 'ANNULLED'];
export class ListCashMovementsDto { @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate?: string; @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate?: string; @IsOptional() @IsIn(['INFLOW', 'OUTFLOW']) direction?: 'INFLOW' | 'OUTFLOW'; @IsOptional() @IsString() concept?: string; @IsOptional() @IsString() paymentMethodId?: string; @IsOptional() @IsString() search?: string; @IsOptional() page?: number; @IsOptional() pageSize?: 20 | 50 | 100; }
export class CreateCashMovementDto { @IsString() concept!: string; @IsString() amount!: string; @Matches(/^\d{4}-\d{2}-\d{2}$/) movementDate!: string; @IsString() paymentMethodId!: string; @IsOptional() @IsString() observations?: string; @IsOptional() @IsString() idempotencyKey?: string; }
export class ReverseCashMovementDto { @Matches(/^\d{4}-\d{2}-\d{2}$/) movementDate!: string; @IsString() reason!: string; }
export class EconomicCapitalQueryDto { @Matches(/^[1-9]\d{3}-(?:0[1-9]|1[0-2])$/) period!: string; }
export class ProfitabilityQueryDto extends EconomicCapitalQueryDto {
  @IsOptional() @IsInt() @Min(1) @Transform(({ value }) => Number(value)) page?: number;
  @IsOptional() @IsIn([10, 20, 50]) @Transform(({ value }) => Number(value)) pageSize?: 10 | 20 | 50;
}
export class NormalProfitabilityQueryDto extends ProfitabilityQueryDto {
  @IsOptional() @IsIn(LOAN_STATUSES) status?: LoanStatus;
}
export class RefinancingProfitabilityQueryDto extends ProfitabilityQueryDto {
  @IsOptional() @IsIn(LOAN_STATUSES) terminalStatus?: LoanStatus;
}
export class ProfitabilityPaymentQueryDto extends ProfitabilityQueryDto {
  @IsOptional() @IsIn(['NORMAL', 'REFINANCING']) source?: 'NORMAL' | 'REFINANCING';
  @IsOptional() @IsString() loanId?: string;
  @IsOptional() @IsString() rootLoanId?: string;
}
