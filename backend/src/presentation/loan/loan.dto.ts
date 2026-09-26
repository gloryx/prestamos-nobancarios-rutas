import { Type } from 'class-transformer';
import { IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, ValidateNested } from 'class-validator';

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

export class LoanListQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsString() frequencyId?: string;
  @IsOptional() @IsString() fromDate?: string;
  @IsOptional() @IsString() toDate?: string;
  @IsOptional() @IsIn(['number', 'customer', 'startDate', 'principal', 'interest', 'total', 'frequency', 'pending']) sortBy?: 'number' | 'customer' | 'startDate' | 'principal' | 'interest' | 'total' | 'frequency' | 'pending';
  @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc';
  @IsOptional() @IsString() page?: string;
  @IsOptional() @IsString() pageSize?: string;
}
