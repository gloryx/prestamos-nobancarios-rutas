import { IsArray, IsDateString, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { PlanBaseline } from '../../domain/payment/payment-invariants';
import { COLLECTION_STATUSES, PORTFOLIO_LOAN_STATUSES, type CollectionStatus, type PortfolioLoanStatus } from '../../application/payment/portfolio-tracking.use-case';
import { COLLECTION_AGENDA_STATUSES, type CollectionAgendaFilterStatus } from '../../application/payment/collection-agenda.use-case';
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
export class CollectionAgendaQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) referenceDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate?: string;
  @IsOptional() @IsUUID() collectorId?: string;
  @IsOptional() @IsUUID() routeId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsIn(['ALL', ...COLLECTION_AGENDA_STATUSES]) collectionStatus?: CollectionAgendaFilterStatus;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) pageSize?: string;
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

export class CollectorPaymentsReportQueryDto {
  @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate!: string;
  @IsOptional() @IsUUID() collectorId?: string;
  @IsOptional() @IsUUID() paymentMethodId?: string;
}

export class PortfolioTrackingQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsIn(['ALL', ...PORTFOLIO_LOAN_STATUSES]) status?: PortfolioLoanStatus | 'ALL';
  @IsOptional() @IsIn(['ALL', ...COLLECTION_STATUSES]) collectionStatus?: CollectionStatus | 'ALL';
  @IsOptional() @Matches(/^[1-9]\d*$/) position?: string;
}
