import { BadRequestException, ConflictException, Controller, Get, Optional, Param, Post, Query, Body, HttpCode, HttpStatus } from '@nestjs/common';
import { CashMovementConflictError, CashMovementNotFoundError, CashMovementValidationError } from '../../domain/cash-movement/cash-movement.errors';
import type { CashMovementConcept } from '../../domain/cash-movement/cash-movement.types';
import { ListCashMovementsUseCase, RecordManualCashMovementUseCase, ReverseCashMovementUseCase, SummarizeCashMovementsUseCase } from '../../application/cash-movement/cash-movement.use-cases';
import { EconomicCapitalUseCase } from '../../application/cash-movement/economic-capital.use-case';
import { MonthlyProfitabilityUseCase } from '../../application/cash-movement/monthly-profitability.use-case';
import { EconomicCapitalValidationError } from '../../domain/cash-movement/economic-capital';
import { economicCapitalResponse } from './economic-capital.response';
import { monthlyProfitabilityResponse } from './monthly-profitability.response';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CreateCashMovementDto, EconomicCapitalQueryDto, ListCashMovementsDto, NormalProfitabilityQueryDto,
  ProfitabilityPaymentQueryDto, ProfitabilityQueryDto, RefinancingProfitabilityQueryDto, ReverseCashMovementDto } from './cash-movement.dto';
const response = (movement: Awaited<ReturnType<ListCashMovementsUseCase['execute']>>['items'][number]) => ({ id: movement.id, direction: movement.direction, concept: movement.concept, amount: movement.amount, movementDate: movement.movementDate, paymentMethod: movement.paymentMethod, observations: movement.observations, reversedMovementId: movement.reversedMovementId, createdBy: movement.createdBy, createdAt: movement.createdAt });
const listResponse = (movement: Awaited<ReturnType<ListCashMovementsUseCase['execute']>>['items'][number]) => ({ ...response(movement), loanNumber: movement.loanNumber ?? null, reversedConcept: movement.reversedConcept ?? null });
@Controller('cash-movements')
export class CashMovementController {
  constructor(private readonly list: ListCashMovementsUseCase, private readonly summary: SummarizeCashMovementsUseCase, private readonly create: RecordManualCashMovementUseCase, private readonly reverse: ReverseCashMovementUseCase, @Optional() private readonly economicCapital?: EconomicCapitalUseCase, @Optional() private readonly profitability?: MonthlyProfitabilityUseCase) {}
  @Get() @RequirePermissions('cash-movements.view') async getList(@Query() query: ListCashMovementsDto) { const pageSize = [20, 50, 100].includes(Number(query.pageSize)) ? Number(query.pageSize) as 20 | 50 | 100 : 20; const result = await this.list.execute({ ...query, concept: query.concept as CashMovementConcept | undefined, page: Math.max(1, Number(query.page) || 1), pageSize }); return { items: result.items.map(listResponse), total: result.total, page: Number(query.page) || 1, pageSize }; }
  @Get('summary') @RequirePermissions('cash-movements.view') getSummary(@Query() query: ListCashMovementsDto) { return this.summary.execute({ ...query, concept: query.concept as CashMovementConcept | undefined }); }
  @Get('capital-rotation') @RequirePermissions('cash-movements.view') async getCapitalRotation(@Query() query: EconomicCapitalQueryDto) { try { return economicCapitalResponse(await this.economicCapital!.execute(query.period)); } catch (error) { if (error instanceof EconomicCapitalValidationError) throw new BadRequestException(error.message); throw error; } }
  @Get('profitability') @RequirePermissions('cash-movements.view') async getProfitability(@Query() query: EconomicCapitalQueryDto) { try { return monthlyProfitabilityResponse(await this.profitability!.summary(query.period)); } catch (error) { if (error instanceof EconomicCapitalValidationError) throw new BadRequestException(error.message); throw error; } }
  @Get('profitability/normal') @RequirePermissions('cash-movements.view') async getNormalProfitability(@Query() query: NormalProfitabilityQueryDto) { return this.profitability!.normal(query.period, this.profitabilityPage(query), { status: query.status }); }
  @Get('profitability/refinancings') @RequirePermissions('cash-movements.view') async getRefinancingProfitability(@Query() query: RefinancingProfitabilityQueryDto) { return this.profitability!.refinancings(query.period, this.profitabilityPage(query), { terminalStatus: query.terminalStatus }); }
  @Get('profitability/payments') @RequirePermissions('cash-movements.view') async getProfitabilityPayments(@Query() query: ProfitabilityPaymentQueryDto) { return this.profitability!.payments(query.period, this.profitabilityPage(query), { source: query.source, loanId: query.loanId, rootLoanId: query.rootLoanId }); }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('cash-movements.create') async createMovement(@Body() body: CreateCashMovementDto, @CurrentUser() actor: CurrentIdentity) { try { return response(await this.create.execute(body as never, actor.id)); } catch (error) { this.mapError(error); } }
  @Post(':id/reverse') @HttpCode(HttpStatus.CREATED) @RequirePermissions('cash-movements.reverse') async reverseMovement(@Param('id') id: string, @Body() body: ReverseCashMovementDto, @CurrentUser() actor: CurrentIdentity) { try { return response(await this.reverse.execute(id, body, actor.id)); } catch (error) { this.mapError(error); } }
  private mapError(error: unknown): never { if (error instanceof CashMovementConflictError) throw new ConflictException(error.message); if (error instanceof CashMovementValidationError) throw new BadRequestException(error.message); if (error instanceof CashMovementNotFoundError) throw new BadRequestException(error.message); throw error; }
  private profitabilityPage(query: ProfitabilityQueryDto) { return { page: query.page ?? 1, pageSize: query.pageSize ?? 20 as 10 | 20 | 50 }; }
}
