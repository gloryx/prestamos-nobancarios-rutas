import { Transform, Type } from 'class-transformer';
import { IsBoolean, IsInt, IsNotEmpty, IsOptional, IsString, Min, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class CreatePaymentMethodDto { @Transform(trim) @IsString() @IsNotEmpty() @MinLength(1) name!: string; @Type(() => Number) @IsInt() @Min(1) order!: number; }
export class UpdatePaymentMethodDto { @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MinLength(1) name?: string; @IsOptional() @Type(() => Number) @IsInt() @Min(1) order?: number; }
export class ChangePaymentMethodStatusDto { @IsBoolean() isActive!: boolean; }
