import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

const AMOUNT = /^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/;

export class SearchLoanRefinancingsDto {
  @IsOptional() @IsString() @MaxLength(120) search?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @IsIn(['10', '20', '50']) pageSize?: string;
}

export class ListLoanRefinancingsDto extends SearchLoanRefinancingsDto {
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;
}

export class PreviewLoanRefinancingDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) refinancingDate?: string;
}

class RefinancingPlanEntryDto {
  @IsInt() @Min(1) sequence!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string;
  @Matches(AMOUNT) pendingAmount!: string;
}

export class ConfirmLoanRefinancingDto {
  @IsUUID() originLoanId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) refinancingDate!: string;
  @Matches(AMOUNT) newMoney!: string;
  @IsOptional() @IsUUID() disbursementPaymentMethodId?: string;
  @Matches(AMOUNT) newInterestAmount!: string;
  @IsUUID() paymentFrequencyId!: string;
  @IsUUID() preferredPaymentMethodId!: string;
  @IsOptional() @IsString() observations?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => RefinancingPlanEntryDto) plan!: RefinancingPlanEntryDto[];
  @Matches(/^[a-f\d]{64}$/i) baseline!: string;
  @Matches(/^[\x21-\x7e]{1,128}$/) idempotencyKey!: string;
}
