import { BadRequestException, ConflictException, Controller, Get, Param, Post, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CashMovementConflictError, CashMovementNotFoundError, CashMovementValidationError } from '../../domain/cash-movement/cash-movement.errors';
import type { CashMovementConcept } from '../../domain/cash-movement/cash-movement.types';
import { ListCashMovementsUseCase, RecordManualCashMovementUseCase, ReverseCashMovementUseCase, SummarizeCashMovementsUseCase } from '../../application/cash-movement/cash-movement.use-cases';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CreateCashMovementDto, ListCashMovementsDto, ReverseCashMovementDto } from './cash-movement.dto';
const response = (movement: Awaited<ReturnType<ListCashMovementsUseCase['execute']>>['items'][number]) => ({ id: movement.id, direction: movement.direction, concept: movement.concept, amount: movement.amount, movementDate: movement.movementDate, paymentMethod: movement.paymentMethod, observations: movement.observations, reversedMovementId: movement.reversedMovementId, createdBy: movement.createdBy, createdAt: movement.createdAt });
@Controller('cash-movements')
export class CashMovementController {
  constructor(private readonly list: ListCashMovementsUseCase, private readonly summary: SummarizeCashMovementsUseCase, private readonly create: RecordManualCashMovementUseCase, private readonly reverse: ReverseCashMovementUseCase) {}
  @Get() @RequirePermissions('cash-movements.view') async getList(@Query() query: ListCashMovementsDto) { const pageSize = [20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) as 20 | 50 | 100 : 20; const result = await this.list.execute({ ...query, concept: query.concept as CashMovementConcept | undefined, page: Math.max(1, Number(query.page) || 1), pageSize }); return { items: result.items.map(response), total: result.total, page: Number(query.page) || 1, pageSize }; }
  @Get('summary') @RequirePermissions('cash-movements.view') getSummary(@Query() query: ListCashMovementsDto) { return this.summary.execute({ ...query, concept: query.concept as CashMovementConcept | undefined }); }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('cash-movements.create') async createMovement(@Body() body: CreateCashMovementDto, @CurrentUser() actor: CurrentIdentity) { try { return response(await this.create.execute(body as never, actor.id)); } catch (error) { this.mapError(error); } }
  @Post(':id/reverse') @HttpCode(HttpStatus.CREATED) @RequirePermissions('cash-movements.reverse') async reverseMovement(@Param('id') id: string, @Body() body: ReverseCashMovementDto, @CurrentUser() actor: CurrentIdentity) { try { return response(await this.reverse.execute(id, body, actor.id)); } catch (error) { this.mapError(error); } }
  private mapError(error: unknown): never { if (error instanceof CashMovementConflictError) throw new ConflictException(error.message); if (error instanceof CashMovementValidationError) throw new BadRequestException(error.message); if (error instanceof CashMovementNotFoundError) throw new BadRequestException(error.message); throw error; }
}
