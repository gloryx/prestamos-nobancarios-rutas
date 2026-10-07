import { IsBoolean, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min } from 'class-validator';
import { Transform } from 'class-transformer';

export class CreateCustomerDto {
  @IsIn(['NATIONAL', 'FOREIGN']) identificationType!: string; @IsString() identification!: string; @IsString() firstName!: string; @IsOptional() @IsString() middleName?: string; @IsString() firstLastName!: string; @IsOptional() @IsString() secondLastName?: string; @IsIn(['MALE', 'FEMALE']) gender!: string; @IsString() birthDate!: string; @IsString() primaryPhone!: string; @IsOptional() @IsString() secondaryPhone?: string; @IsOptional() @IsString() email?: string; @IsIn(['COSTA_RICAN', 'NICARAGUAN', 'PANAMANIAN', 'HONDURAN', 'OTHER']) nationality!: string; @IsOptional() @IsString() otherNationality?: string; @IsString() districtCode!: string; @IsString() exactAddress!: string; @IsOptional() @IsString() latitude?: string; @IsOptional() @IsString() longitude?: string; @IsOptional() @IsString() observations?: string;
}

export class UpdateCustomerDto {
  @IsOptional() @IsIn(['NATIONAL', 'FOREIGN']) identificationType?: string; @IsOptional() @IsString() identification?: string; @IsOptional() @IsString() firstName?: string; @IsOptional() @IsString() middleName?: string; @IsOptional() @IsString() firstLastName?: string; @IsOptional() @IsString() secondLastName?: string; @IsOptional() @IsIn(['MALE', 'FEMALE']) gender?: string; @IsOptional() @IsString() birthDate?: string; @IsOptional() @IsString() primaryPhone?: string; @IsOptional() @IsString() secondaryPhone?: string; @IsOptional() @IsString() email?: string; @IsOptional() @IsIn(['COSTA_RICAN', 'NICARAGUAN', 'PANAMANIAN', 'HONDURAN', 'OTHER']) nationality?: string; @IsOptional() @IsString() otherNationality?: string; @IsOptional() @IsString() districtCode?: string; @IsOptional() @IsString() exactAddress?: string; @IsOptional() @IsString() latitude?: string; @IsOptional() @IsString() longitude?: string; @IsOptional() @IsString() observations?: string;
}

export class CustomerListQueryDto { @IsOptional() @IsString() search?: string; @IsOptional() @IsIn(['ACTIVE', 'INACTIVE', 'ALL']) status?: string; @IsOptional() @IsIn(['identification', 'name', 'phone', 'address', 'status']) sortBy?: 'identification' | 'name' | 'phone' | 'address' | 'status'; @IsOptional() @IsIn(['asc', 'desc']) sortOrder?: 'asc' | 'desc'; @IsOptional() @IsInt() @Transform(({ value }) => Number(value)) @Min(1) page?: number; @IsOptional() @IsIn([10, 20, 50]) @IsInt() @Transform(({ value }) => Number(value)) pageSize?: number; }
export class CustomerStatusDto { @IsBoolean() isActive!: boolean; }
export class CustomerFinancialAnalysisQueryDto { @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) asOf?: string; }
export class CustomerStatisticsQueryDto { @IsOptional() @Matches(/^[1-9]\d{3}$/) year?: string; @IsOptional() @IsInt() @Transform(({ value }) => Number(value)) @Min(1) limit?: number; }
export class CustomerAgendaQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsUUID() collectorId?: string;
  @IsOptional() @IsUUID() routeId?: string;
  @IsOptional() @IsInt() @Min(1) @Transform(({ value }) => Number(value)) provinceCode?: number;
  @IsOptional() @IsInt() @Min(1) @Transform(({ value }) => Number(value)) cantonCode?: number;
  @IsOptional() @IsInt() @Min(1) @Transform(({ value }) => Number(value)) districtCode?: number;
  @IsOptional() @IsIn(['ALL', 'ASSIGNED', 'UNASSIGNED']) assignmentStatus?: 'ALL' | 'ASSIGNED' | 'UNASSIGNED';
  @IsOptional() @IsInt() @Min(1) @Transform(({ value }) => Number(value)) page?: number;
  @IsOptional() @IsInt() @IsIn([10, 20, 50]) @Transform(({ value }) => Number(value)) pageSize?: 10 | 20 | 50;
}
