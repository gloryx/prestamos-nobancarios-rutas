import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsEnum, IsInt, IsNotEmpty, IsOptional, IsString, Min, MinLength } from 'class-validator';
import type { IntervalUnit } from '../../domain/payment-frequency/payment-frequency.types';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class CreatePaymentFrequencyDto { @Transform(trim) @IsString() @IsNotEmpty() @MinLength(1) name!: string; @IsEnum({ DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH' }) intervalUnit!: IntervalUnit; @Type(() => Number) @IsInt() @Min(1) intervalValue!: number; @Type(() => Number) @IsInt() @Min(1) order!: number; }
export class UpdatePaymentFrequencyDto { @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MinLength(1) name?: string; @IsOptional() @IsEnum({ DAY: 'DAY', WEEK: 'WEEK', MONTH: 'MONTH' }) intervalUnit?: IntervalUnit; @IsOptional() @Type(() => Number) @IsInt() @Min(1) intervalValue?: number; @IsOptional() @Type(() => Number) @IsInt() @Min(1) order?: number; }
export class ChangePaymentFrequencyStatusDto { @IsBoolean() isActive!: boolean; }
