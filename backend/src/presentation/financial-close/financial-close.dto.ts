import { IsIn, IsInt, IsOptional, Matches, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';

export class FinancialClosePeriodDto { @Matches(/^\d{4}-(0[1-9]|1[0-2])$/) period!: string; }
export class ConfirmFinancialCloseDto extends FinancialClosePeriodDto {}
export class ListFinancialClosesDto {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(10) @Max(50) @IsIn([10, 20, 50]) pageSize: 10 | 20 | 50 = 20;
}
