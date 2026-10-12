import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, MinLength, Validate, ValidateNested, ValidatorConstraint, type ValidatorConstraintInterface, type ValidationArguments } from 'class-validator';

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

class RefinancingAnnulmentFiltersDto extends SearchLoanRefinancingsDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateFrom?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) dateTo?: string;
}

export class ListRefinancingAnnulmentsDto extends RefinancingAnnulmentFiltersDto {
  @IsOptional() @IsIn(['refinancingDate', 'effectiveDate', 'customer', 'originLoan', 'successorLoan',
    'annulmentType', 'createdBy']) sortBy?: 'refinancingDate' | 'effectiveDate' | 'customer' | 'originLoan' |
      'successorLoan' | 'annulmentType' | 'createdBy';
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}

export class ListAnnullableRefinancingsDto extends RefinancingAnnulmentFiltersDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate?: string;
  @IsOptional() @IsIn(['refinancingDate', 'customer', 'originLoan', 'successorLoan', 'newMoneyDisbursed'])
    sortBy?: 'refinancingDate' | 'customer' | 'originLoan' | 'successorLoan' | 'newMoneyDisbursed';
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
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

@ValidatorConstraint({ name: 'refinancingAnnulmentEffectiveDate', async: false })
class RefinancingAnnulmentEffectiveDateConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    const type = (args.object as AnnulLoanRefinancingDto).annulmentType;
    if (type === 'DATA_CORRECTION') return value === undefined;
    return type === 'CASH_REFUND' && typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
  }

  defaultMessage() { return 'effectiveDate is required only for CASH_REFUND.'; }
}

@ValidatorConstraint({ name: 'refinancingAnnulmentRefundMethod', async: false })
class RefinancingAnnulmentRefundMethodConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    return (args.object as AnnulLoanRefinancingDto).annulmentType !== 'DATA_CORRECTION' || value === undefined;
  }

  defaultMessage() { return 'refundPaymentMethodId is not allowed for DATA_CORRECTION.'; }
}

@ValidatorConstraint({ name: 'refinancingAnnulmentResolution', async: false })
class RefinancingAnnulmentResolutionConstraint implements ValidatorConstraintInterface {
  validate(value: unknown, args: ValidationArguments) {
    if (value === undefined) return true;
    return (args.object as AnnulLoanRefinancingDto).annulmentType === 'DATA_CORRECTION'
      ? value === 'NOT_DELIVERED' : value === 'RETURNED_IN_FULL';
  }

  defaultMessage() { return 'disbursementResolution is inconsistent with the annulment type.'; }
}

export class AnnulLoanRefinancingDto {
  @IsIn(['DATA_CORRECTION', 'CASH_REFUND']) annulmentType!: 'DATA_CORRECTION' | 'CASH_REFUND';
  @IsOptional() @IsIn(['NOT_DELIVERED', 'RETURNED_IN_FULL']) @Validate(RefinancingAnnulmentResolutionConstraint)
    disbursementResolution?: 'NOT_DELIVERED' | 'RETURNED_IN_FULL';
  @Validate(RefinancingAnnulmentEffectiveDateConstraint) effectiveDate?: string;
  @IsOptional() @IsUUID() @Validate(RefinancingAnnulmentRefundMethodConstraint) refundPaymentMethodId?: string;
  @IsString() @MinLength(8) @MaxLength(500) reason!: string;
  @Matches(/^[\x21-\x7e]{1,128}$/) idempotencyKey!: string;
}
