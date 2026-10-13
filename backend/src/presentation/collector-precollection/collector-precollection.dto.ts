import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { COLLECTOR_CUSTODY_TREATMENTS, COLLECTOR_PRECOLLECTION_STATUSES, type CollectorCustodyTreatment, type CollectorPrecollectionStatus } from '../../domain/collector-precollection/collector-precollection.types';

export class CreateCollectorPrecollectionDto {
  @IsUUID() customerId!: string;
  @IsUUID() loanId!: string;
  @IsUUID() paymentMethodId!: string;
  @IsIn(COLLECTOR_CUSTODY_TREATMENTS) custodyTreatment!: CollectorCustodyTreatment;
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amount!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsOptional() @IsString() @MaxLength(200) reference?: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsString() @MaxLength(128) idempotencyKey!: string;
}

export class CollectorPrecollectionListQueryDto {
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) date?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) fromDate?: string;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) toDate?: string;
  @IsOptional() @IsIn(COLLECTOR_PRECOLLECTION_STATUSES) status?: CollectorPrecollectionStatus;
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsUUID() paymentMethodId?: string;
  @IsOptional() @IsUUID() collectorId?: string;
  @IsOptional() @IsUUID() routeId?: string;
  @IsOptional() @Matches(/^[1-9]\d*$/) page?: string;
  @IsOptional() @Matches(/^(?:[1-9]\d?|100)$/) pageSize?: string;
  @IsOptional() @IsIn(['effectiveDate', 'recordedAt', 'amount', 'status', 'customer', 'loanNumber']) sortBy?: string;
  @IsOptional() @IsIn(['asc', 'desc']) sortDir?: 'asc' | 'desc';
}

export class CancelCollectorPrecollectionDto {
  @IsString() @MaxLength(500) reason!: string;
  @IsString() @MaxLength(128) idempotencyKey!: string;
}
