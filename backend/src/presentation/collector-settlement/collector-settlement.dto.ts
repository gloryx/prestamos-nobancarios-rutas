import { ArrayNotEmpty, ArrayUnique, IsArray, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

export class CreateCollectorSettlementDto {
  @IsOptional() @IsUUID() collectorId?: string;
  @IsArray() @ArrayNotEmpty() @ArrayUnique() @IsUUID('4', { each: true }) precollectionIds!: string[];
  @IsString() @MaxLength(128) idempotencyKey!: string;
}
export class SettlementActionDto {
  @IsOptional() @IsString() @MaxLength(500) reason?: string;
  @IsString() @MaxLength(128) idempotencyKey!: string;
}
export class ConfirmCollectorSettlementDto {
  @Matches(/^(?:0|[1-9]\d{0,15})(?:\.\d{1,2})?$/) amountDelivered!: string;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) deliveryDate!: string;
  @IsOptional() @IsUUID() deliveryPaymentMethodId!: string | null;
  @IsOptional() @IsString() @MaxLength(200) deliveryReference!: string | null;
  @IsOptional() @IsString() @MaxLength(1000) deliveryNotes!: string | null;
  @IsString() @MaxLength(128) idempotencyKey!: string;
}
