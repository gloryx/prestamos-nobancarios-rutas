import { IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches } from 'class-validator';
import type { PlanBaseline } from '../../domain/payment/payment-invariants';
export class CreatePaymentDto { @IsString() loanId!: string; @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amount!: string; @IsDateString() paymentDate!: string; @IsString() methodId!: string; @IsUUID(undefined, { message: 'Seleccione un cobrador.' }) collectorId!: string; @IsString() idempotencyKey!: string; }
export class AnnulPaymentDto { @IsString() reason!: string; @IsString() idempotencyKey!: string; }
export class CustomizePaymentPlanDto { @IsArray() entries!: Array<{ id: string | null; dueDate: string; pendingAmount: string }>; @IsObject() base!: PlanBaseline; @IsString() idempotencyKey!: string; }
export class DailyCollectionDateDto { @Matches(/^\d{4}-\d{2}-\d{2}$/) date!: string; }
export class DailyCollectionsQueryDto extends DailyCollectionDateDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) pageSize?: string;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}
export class PaymentHistoryQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) startDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) endDate?: string;
  @IsOptional() @IsString() search?: string;
  @IsOptional() @Matches(/^[1-9]\d{0,18}$/) loanNumber?: string;
  @IsOptional() @IsIn(['VALID', 'ANNULLED']) status?: 'VALID' | 'ANNULLED';
  @IsOptional() @IsString() paymentMethodId?: string;
  @IsOptional() @IsString() collectorId?: string;
  @IsOptional() @IsString() sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) pageSize?: string;
}
