import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException,
  Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CollectorSettlementConflictError, CollectorSettlementForbiddenError, CollectorSettlementNotFoundError,
  CollectorSettlementValidationError } from '../../domain/collector-settlement/collector-settlement.errors';
import { ConfirmCollectorSettlementUseCase, CreateCollectorSettlementUseCase, GetCollectorSettlementUseCase,
  ListCollectorSettlementsUseCase, TransitionCollectorSettlementUseCase } from '../../application/collector-settlement/collector-settlement.use-cases';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import { ConfirmCollectorSettlementDto, CreateCollectorSettlementDto, SettlementActionDto } from './collector-settlement.dto';

@Controller('collector-settlements')
export class CollectorSettlementController {
  constructor(private readonly createUseCase: CreateCollectorSettlementUseCase,
    private readonly listUseCase: ListCollectorSettlementsUseCase,
    private readonly detailUseCase: GetCollectorSettlementUseCase,
    private readonly transitionUseCase: TransitionCollectorSettlementUseCase,
    private readonly confirmUseCase: ConfirmCollectorSettlementUseCase) {}
  @Post() @RequirePermissions()
  async create(@Body() body: CreateCollectorSettlementDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.createUseCase.execute(body, actor)); }
  @Get('mine') @RequirePermissions()
  async mine(@CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.listUseCase.execute(actor, true)); }
  @Get() @RequirePermissions('collector-settlements.view')
  async list(@CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.listUseCase.execute(actor, false)); }
  @Get(':id') @RequirePermissions()
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.detailUseCase.execute(id, actor)); }
  @Post(':id/submit') @RequirePermissions()
  submit(@Param('id', ParseUUIDPipe) id: string, @Body() body: SettlementActionDto, @CurrentUser() actor: CurrentIdentity) { return this.action(id, 'submit', body, actor); }
  @Post(':id/review') @RequirePermissions('collector-settlements.review')
  review(@Param('id', ParseUUIDPipe) id: string, @Body() body: SettlementActionDto, @CurrentUser() actor: CurrentIdentity) { return this.action(id, 'review', body, actor); }
  @Post(':id/reject') @RequirePermissions('collector-settlements.reject')
  reject(@Param('id', ParseUUIDPipe) id: string, @Body() body: SettlementActionDto, @CurrentUser() actor: CurrentIdentity) { return this.action(id, 'reject', body, actor); }
  @Post(':id/cancel') @RequirePermissions()
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: SettlementActionDto, @CurrentUser() actor: CurrentIdentity) { return this.action(id, 'cancel', body, actor); }
  @Post(':id/confirm') @RequirePermissions('collector-settlements.confirm')
  async confirm(@Param('id', ParseUUIDPipe) id: string, @Body() body: ConfirmCollectorSettlementDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.confirmUseCase.execute(id, body, actor)); }
  private action(id: string, action: 'submit' | 'review' | 'reject' | 'cancel', body: SettlementActionDto, actor: CurrentIdentity) {
    return this.handle(() => this.transitionUseCase.execute(id, action, body, actor));
  }
  private async handle<T>(call: () => Promise<T>): Promise<T> { try { return await call(); } catch (error) {
    if (error instanceof CollectorSettlementValidationError) throw new BadRequestException({ message: error.message,
      errorCode: 'VALIDATION_FAILED', reasonCode: error.reasonCode, ...(error.field && { data: { fields: [{ field: error.field, codes: [error.reasonCode], message: error.message }] } }) });
    if (error instanceof CollectorSettlementConflictError) throw new ConflictException({ message: error.message, errorCode: 'RESOURCE_STATE_CONFLICT', reasonCode: error.reasonCode });
    if (error instanceof CollectorSettlementForbiddenError) throw new ForbiddenException(error.message);
    if (error instanceof CollectorSettlementNotFoundError) throw new NotFoundException(error.message);
    throw error;
  } }
}
