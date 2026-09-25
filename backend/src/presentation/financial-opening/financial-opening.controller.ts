import { BadRequestException, ConflictException, Controller, Get, HttpCode, HttpStatus, Post, Body } from '@nestjs/common';
import { GetFinancialOpeningUseCase, PerformFinancialOpeningUseCase } from '../../application/financial-opening/financial-opening.use-cases';
import { FinancialOpeningAlreadyPerformedError, FinancialOpeningValidationError } from '../../domain/financial-opening/financial-opening.errors';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { PerformFinancialOpeningDto } from './financial-opening.dto';

@Controller('financial-opening')
export class FinancialOpeningController {
  constructor(private readonly get: GetFinancialOpeningUseCase, private readonly perform: PerformFinancialOpeningUseCase) {}
  @Get() @RequirePermissions('financial-opening.view') async getOpening() { const opening = await this.get.execute(); return { configured: Boolean(opening), opening: opening ? this.toResponse(opening) : null }; }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('financial-opening.perform') async performOpening(@Body() body: PerformFinancialOpeningDto, @CurrentUser() actor: CurrentIdentity) { try { return this.toResponse(await this.perform.execute(body, actor.id)); } catch (error) { if (error instanceof FinancialOpeningAlreadyPerformedError || (error instanceof Error && error.message === 'La apertura financiera ya fue realizada.')) throw new ConflictException('La apertura financiera ya fue realizada.'); if (error instanceof FinancialOpeningValidationError) throw new BadRequestException(error.message); throw error; } }
  private toResponse(opening: Awaited<ReturnType<GetFinancialOpeningUseCase['execute']>> & object) { const { id, openingDate, initialAvailableAmount, initialPortfolio, initialUncollectibleAmount, historicalSeedCapital, observations, openedAt, openedBy } = opening; return { id, openingDate, initialAvailableAmount, initialPortfolio, initialUncollectibleAmount, historicalSeedCapital, observations, openedAt, openedBy }; }
}
