import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException,
  Post, Query } from '@nestjs/common';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CollectorCustodyConflictError, CollectorCustodyForbiddenError, CollectorCustodyNotFoundError,
  CollectorCustodyValidationError } from '../../domain/collector-custody/collector-custody.errors';
import { RecordCollectorCustodyUseCase, ViewCollectorCustodyUseCase } from '../../application/collector-custody/collector-custody.use-cases';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import { CollectorCustodyMovementDto, CollectorCustodyQueryDto } from './collector-custody.dto';

@Controller('collector-custody')
export class CollectorCustodyController {
  constructor(private readonly viewUseCase: ViewCollectorCustodyUseCase,
    private readonly recordUseCase: RecordCollectorCustodyUseCase) {}
  @Get('summary') @RequirePermissions()
  summary(@Query() query: CollectorCustodyQueryDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.viewUseCase.summary(query.collectorId, actor)); }
  @Get('movements') @RequirePermissions()
  history(@Query() query: CollectorCustodyQueryDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.viewUseCase.history(query.collectorId, actor)); }
  @Post('remittances') @RequirePermissions()
  remit(@Body() body: CollectorCustodyMovementDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.recordUseCase.execute('remittance', body, actor)); }
  @Post('top-ups') @RequirePermissions('collector-custody.topup')
  topup(@Body() body: CollectorCustodyMovementDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.recordUseCase.execute('topup', body, actor)); }
  @Post('adjustments') @RequirePermissions('collector-custody.adjust')
  adjustment(@Body() body: CollectorCustodyMovementDto, @CurrentUser() actor: CurrentIdentity) { return this.handle(() => this.recordUseCase.execute('adjustment', body, actor)); }
  private async handle<T>(call: () => Promise<T>): Promise<T> { try { return await call(); } catch (error) {
    if (error instanceof CollectorCustodyValidationError) throw new BadRequestException({ message: error.message,
      errorCode: 'VALIDATION_FAILED', reasonCode: error.reasonCode, ...(error.field && { data: { fields: [{ field: error.field, codes: [error.reasonCode], message: error.message }] } }) });
    if (error instanceof CollectorCustodyConflictError) throw new ConflictException({ message: error.message, errorCode: 'RESOURCE_STATE_CONFLICT', reasonCode: error.reasonCode });
    if (error instanceof CollectorCustodyForbiddenError) throw new ForbiddenException(error.message);
    if (error instanceof CollectorCustodyNotFoundError) throw new NotFoundException(error.message);
    throw error;
  } }
}
