import { IsOptional, IsString, Matches } from 'class-validator';
export class PerformFinancialOpeningDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) openingDate!: string;
  @IsString() initialAvailableAmount!: string;
  @IsString() initialPortfolio!: string;
  @IsString() initialUncollectibleAmount!: string;
  @IsString() historicalSeedCapital!: string;
  @IsOptional() @IsString() observations?: string;
}
