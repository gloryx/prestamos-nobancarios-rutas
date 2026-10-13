import { IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import type { CollectorCustodyDirection } from '../../domain/collector-custody/collector-custody.types';
export class CollectorCustodyQueryDto { @IsOptional() @IsUUID() collectorId?: string; }
export class CollectorCustodyMovementDto {
  @IsOptional() @IsUUID() collectorId?: string;
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amount!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveDate!: string;
  @IsUUID() paymentMethodId!: string;
  @IsString() @MaxLength(200) reference!: string;
  @IsString() @MaxLength(500) reason!: string;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
  @IsOptional() @IsIn(['CREDIT', 'DEBIT']) direction?: CollectorCustodyDirection;
  @IsString() @MaxLength(128) idempotencyKey!: string;
}
