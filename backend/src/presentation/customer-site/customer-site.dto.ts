import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, MaxLength, Min } from 'class-validator';
export class CreateSiteAuthorizationDto { @IsString() collectorUserId!: string; @IsIn(['LOCATION','PHOTO','LOCATION_AND_PHOTO']) scope!: string; @IsString() reason!: string; @IsString() expiresAt!: string; }

export class AssignedCustomersQueryDto {
  @IsOptional() @IsString() @MaxLength(200) search?: string;
  @IsOptional() @IsUUID() routeId?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page = 1;
  @IsOptional() @IsIn([10, 20, 50]) @Type(() => Number) pageSize: 10 | 20 | 50 = 20;
}
