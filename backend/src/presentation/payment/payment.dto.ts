import { IsArray, IsDateString, IsObject, IsOptional, IsString, Matches } from 'class-validator';
import type { PlanBaseline } from '../../domain/payment/payment-invariants';
export class CreatePaymentDto { @IsString() loanId!: string; @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amount!: string; @IsDateString() paymentDate!: string; @IsString() methodId!: string; @IsOptional() @IsString() collectorId?: string; @IsString() idempotencyKey!: string; }
export class AnnulPaymentDto { @IsString() reason!: string; @IsString() idempotencyKey!: string; }
export class CustomizePaymentPlanDto { @IsArray() entries!: Array<{ id: string | null; dueDate: string; pendingAmount: string }>; @IsObject() base!: PlanBaseline; @IsString() idempotencyKey!: string; }
