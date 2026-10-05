import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsString, IsUUID, Matches, Min, ValidateNested } from 'class-validator';

const operationTypes = ['ASSIGN_ROUTE_TO_COLLECTOR', 'MOVE_ROUTE_TO_COLLECTOR', 'UNASSIGN_ROUTE_FROM_COLLECTOR', 'ASSIGN_CUSTOMER_TO_ROUTE', 'MOVE_CUSTOMER_TO_ROUTE', 'UNASSIGN_CUSTOMER_FROM_ROUTE'] as const;

export class AssignmentWorkspaceQueryDto {
  @IsOptional() @IsString() search?: string;
  @IsOptional() @IsInt() @Min(1) @Type(() => Number) page?: number;
  @IsOptional() @IsIn([10, 20, 50]) @Type(() => Number) pageSize?: 10 | 20 | 50;
}

export class AssignmentBatchOperationDto {
  @IsIn(operationTypes) type!: (typeof operationTypes)[number];
  @IsOptional() @IsUUID() routeId?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() collectorUserId?: string;
  @IsOptional() @IsUUID() expectedAssignmentId?: string;
}

export class AssignmentBatchDto {
  @Matches(/^[a-f0-9]{64}$/) snapshotToken!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(100) @ValidateNested({ each: true }) @Type(() => AssignmentBatchOperationDto) operations!: AssignmentBatchOperationDto[];
}
