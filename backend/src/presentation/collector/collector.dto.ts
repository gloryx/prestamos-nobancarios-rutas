import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class CollectorListQueryDto { @IsOptional() @IsString() search?: string; @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) status?: 'ACTIVE' | 'INACTIVE' | 'ALL'; @IsOptional() @IsInt() @Min(1) @Transform(({ value }) => Number(value)) page?: number; @IsOptional() @IsIn([10, 20, 50]) @IsInt() @Transform(({ value }) => Number(value)) pageSize?: 10 | 20 | 50; }
export class CreateCollectorDto { @IsString() identification!: string; @IsString() firstName!: string; @IsString() firstLastName!: string; @IsOptional() @IsString() secondLastName?: string; @IsString() phone!: string; @IsOptional() @IsString() alternativePhone?: string; @IsOptional() @IsString() email?: string; @IsString() birthDate!: string; @IsString() address!: string; @IsOptional() @IsUUID() userId?: string; }
export class UpdateCollectorDto { @IsOptional() @IsString() identification?: string; @IsOptional() @IsString() firstName?: string; @IsOptional() @IsString() firstLastName?: string; @IsOptional() @IsString() secondLastName?: string; @IsOptional() @IsString() phone?: string; @IsOptional() @IsString() alternativePhone?: string; @IsOptional() @IsString() email?: string; @IsOptional() @IsString() birthDate?: string; @IsOptional() @IsString() address?: string; }
export class CollectorStatusDto { @IsBoolean() isActive!: boolean; }
export class CollectorUserDto { @IsOptional() @IsUUID() userId?: string | null; }
