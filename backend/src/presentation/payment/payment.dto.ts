import { IsArray, IsDateString, IsOptional, IsString, Matches } from 'class-validator';
export class CreatePaymentDto { @IsString() loanId!: string; @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amount!: string; @IsDateString() paymentDate!: string; @IsString() methodId!: string; @IsOptional() @IsString() collectorId?: string; @IsString() idempotencyKey!: string; }
export class AnnulPaymentDto { @IsString() reason!: string; @IsString() idempotencyKey!: string; }
export class CustomizePaymentPlanDto { @IsArray() entries!: Array<{ dueDate: string; pendingAmount: string }>; @IsString() idempotencyKey!: string; }
