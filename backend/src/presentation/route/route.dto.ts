import { Transform } from 'class-transformer';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value;
export class CreateRouteDto { @Transform(trim) @IsString() @IsNotEmpty() @MinLength(1) name!: string; }
export class UpdateRouteDto { @IsOptional() @Transform(trim) @IsString() @IsNotEmpty() @MinLength(1) name?: string; }
export class ChangeRouteStatusDto { @IsBoolean() isActive!: boolean; }
