import { Type } from 'class-transformer';
import { ArrayUnique, IsArray, IsDefined, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, Validate, ValidateIf, ValidateNested, ValidatorConstraint, type ValidatorConstraintInterface } from 'class-validator';
import type { OverdueLoanSort } from '../../application/loan/overdue-loans.use-case';
import type { UncollectibleLoanSort } from '../../application/loan/uncollectible-loans.use-case';

export class MarkUncollectibleDto {
  @IsString() @Matches(/\S/) reason!: string;
  @IsString() @Matches(/\S/) @MaxLength(128) idempotencyKey!: string;
}
export class ReactivateLoanDto extends MarkUncollectibleDto {}

export class PaymentPlanEntryDto { @IsInt() @Min(1) sequence!: number; @Matches(/^\d{4}-\d{2}-\d{2}$/) dueDate!: string; @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) pendingAmount!: string; }
export class CreateLoanDto {
  @IsUUID() customerId!: string;
  @IsUUID() paymentFrequencyId!: string;
  @IsUUID() preferredPaymentMethodId!: string;
  @IsUUID() disbursementPaymentMethodId!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate!: string;
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) principal!: string;
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) interestAmount!: string;
  @IsOptional() @IsString() observations?: string;
  @IsArray() @ValidateNested({ each: true }) @Type(() => PaymentPlanEntryDto) plan!: PaymentPlanEntryDto[];
  @IsOptional() @IsString() idempotencyKey?: string;
}

class LoanEditBaselinePlanEntryDto {
  @IsUUID() id!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) dueDate!: string;
  @Matches(/^(?=.*[1-9])(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) pendingAmount!: string;
}

class LoanEditPlanEntryDto {
  @ValidateIf((_, value: unknown) => value !== null) @IsUUID() id!: string | null;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) @IsISO8601({ strict: true }) dueDate!: string;
  @Matches(/^(?=.*[1-9])(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) pendingAmount!: string;
}

class LoanEditBaselineDto {
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) interestAmount!: string;
  @IsUUID() paymentFrequencyId!: string;
  @IsUUID() preferredPaymentMethodId!: string;
  @ValidateIf((_, value: unknown) => value !== null) @IsString() observations!: string | null;
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) financialBalance!: string;
  @IsArray() @ArrayUnique((row: LoanEditBaselinePlanEntryDto) => typeof row?.id === 'string' ? row.id.toLowerCase() : row?.id)
  @ValidateNested({ each: true }) @Type(() => LoanEditBaselinePlanEntryDto) plan!: LoanEditBaselinePlanEntryDto[];
}

class LoanEditChangesDto {
  @ValidateIf((_, value: unknown) => value !== undefined) @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) interestAmount?: string;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsUUID() paymentFrequencyId?: string;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsUUID() preferredPaymentMethodId?: string;
  @ValidateIf((_, value: unknown) => value !== undefined && value !== null) @IsString() observations?: string | null;
}

@ValidatorConstraint()
class HasLoanEditChange implements ValidatorConstraintInterface {
  validate(value: unknown): boolean {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    const changes = value as Record<string, unknown>;
    return ['interestAmount', 'paymentFrequencyId', 'preferredPaymentMethodId', 'observations']
      .some((field) => changes[field] !== undefined);
  }
}

// Unpublished body contract; no PATCH route is registered by this DTO.
export class LoanEditDto {
  @Matches(/^[\x21-\x7e]{1,128}$/) idempotencyKey!: string;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => LoanEditBaselineDto) baseline!: LoanEditBaselineDto;
  @IsDefined() @IsObject() @Validate(HasLoanEditChange) @ValidateNested() @Type(() => LoanEditChangesDto) changes!: LoanEditChangesDto;
  @ValidateIf((_, value: unknown) => value !== undefined) @IsArray() @ValidateNested({ each: true }) @Type(() => LoanEditPlanEntryDto) plan?: LoanEditPlanEntryDto[];
}

export class LoanListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() frequencyId?: string;
  @IsOptional() @IsString() fromDate?: string;
  @IsOptional() @IsString() toDate?: string;
  @IsOptional() @IsIn(['number', 'customer', 'startDate', 'principal', 'interest', 'total', 'frequency', 'pending', 'condition']) sortBy?: 'number' | 'customer' | 'startDate' | 'principal' | 'interest' | 'total' | 'frequency' | 'pending' | 'condition';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}

export class CancelledLoansQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @IsOptional() @IsIn(['loanNumber', 'customer', 'startDate', 'cancelledDate', 'principal', 'recoveredInterest', 'totalRecovered']) sortBy?: 'loanNumber' | 'customer' | 'startDate' | 'cancelledDate' | 'principal' | 'recoveredInterest' | 'totalRecovered';
  @IsOptional() @IsIn(['asc', 'desc']) sortDirection?: 'asc' | 'desc';
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) pageSize?: string;
}

export class OverdueLoansQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @IsIn(['10', '20', '50']) pageSize?: string;
  @IsOptional() @IsIn(['loanNumber', 'customer', 'startDate', 'firstOverdueDueDate', 'principal', 'recoveredAmount', 'financialBalance']) sortBy?: OverdueLoanSort;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}

export class UncollectibleLoansQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @IsIn(['10', '20', '50']) pageSize?: string;
  @IsOptional() @IsIn(['loanNumber', 'customer', 'startDate', 'uncollectibleDate', 'principal', 'recoveredAmount', 'financialBalance']) sortBy?: UncollectibleLoanSort;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}
