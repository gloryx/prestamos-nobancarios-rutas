import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Optional, Param, Post, Put, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CustomizePaymentPlanUseCase, PaymentConflictError, PaymentContextUseCase, PaymentNotFoundError, PaymentValidationError, RegisterPaymentUseCase } from '../../application/payment/payment.use-case';
import { DailyCollectionsForbiddenError, DailyCollectionsUseCase, DailyCollectionsValidationError } from '../../application/payment/daily-collections.use-case';
import { PaymentHistoryUseCase, PaymentHistoryValidationError } from '../../application/payment/payment-history.use-case';
import { AnnulPaymentDto, CreatePaymentDto, CustomizePaymentPlanDto, DailyCollectionDateDto, DailyCollectionsQueryDto, PaymentHistoryQueryDto, PortfolioTrackingQueryDto } from './payment.dto';
import { PortfolioTrackingUseCase } from '../../application/payment/portfolio-tracking.use-case';
import { CollectionAgendaForbiddenError, CollectionAgendaUseCase, CollectionAgendaValidationError } from '../../application/payment/collection-agenda.use-case';
import { CollectionAgendaQueryDto } from './payment.dto';
import { CollectorPaymentsReportUseCase, CollectorPaymentsReportValidationError } from '../../application/payment/collector-payments-report.use-case';
import { CollectorPaymentsReportQueryDto } from './payment.dto';

@Controller('payments')
export class PaymentController {
  constructor(private readonly register: RegisterPaymentUseCase, private readonly context: PaymentContextUseCase,
    private readonly customize: CustomizePaymentPlanUseCase, @Optional() private readonly daily?: DailyCollectionsUseCase,
    @Optional() private readonly history?: PaymentHistoryUseCase, @Optional() private readonly portfolio?: PortfolioTrackingUseCase,
    @Optional() private readonly collectionAgenda?: CollectionAgendaUseCase,
    @Optional() private readonly collectorReport?: CollectorPaymentsReportUseCase) {}
  @Get('history') @RequirePermissions('payments.view') async paymentHistory(@Query() query: PaymentHistoryQueryDto) {
    try { return await this.history!.list({ ...query, page: query.page === undefined ? undefined : Number(query.page),
      pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize) }); }
    catch (error) { if (error instanceof PaymentHistoryValidationError) throw new BadRequestException(error.message); throw error; }
  }
  @Get('history/options') @RequirePermissions('payments.view') historyOptions() { return this.history!.options(); }
  @Get('collector-report') @RequirePermissions('payments.view') async collectorPaymentsReport(@Query() query: CollectorPaymentsReportQueryDto) {
    try { return await this.collectorReport!.execute(query); }
    catch (error) { if (error instanceof CollectorPaymentsReportValidationError) throw new BadRequestException(error.message); throw error; }
  }
  @Get('daily-collections/summary') @RequirePermissions('payments.view') async dailySummary(@Query() query: DailyCollectionDateDto) {
    try { return await this.daily!.summary(query.date); }
    catch (error) { return this.mapDaily(error); }
  }
  @Get('daily-collections/due') @RequirePermissions('payments.view') async dailyDue(@Query() query: DailyCollectionsQueryDto) {
    try { return await this.daily!.due(this.dailyFilters(query)); }
    catch (error) { return this.mapDaily(error); }
  }
  @Get('daily-collections/received') @RequirePermissions('payments.view') async dailyReceived(@Query() query: DailyCollectionsQueryDto) {
    try { return await this.daily!.received(this.dailyFilters(query)); }
    catch (error) { return this.mapDaily(error); }
  }
  @Get('daily-collections/assigned/summary') @RequirePermissions('daily-collections.assigned.view') async assignedDailySummary(@Query() query: DailyCollectionDateDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.daily!.assignedSummary(query.date, actor); }
    catch (error) { return this.mapDaily(error); }
  }
  @Get('daily-collections/assigned/due') @RequirePermissions('daily-collections.assigned.view') async assignedDailyDue(@Query() query: DailyCollectionsQueryDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.daily!.assignedDue(this.dailyFilters(query), actor); }
    catch (error) { return this.mapDaily(error); }
  }
  @Get('daily-collections/assigned/received') @RequirePermissions('daily-collections.assigned.view') async assignedDailyReceived(@Query() query: DailyCollectionsQueryDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.daily!.assignedReceived(this.dailyFilters(query), actor); }
    catch (error) { return this.mapDaily(error); }
  }
  private dailyFilters(query: DailyCollectionsQueryDto) { return { ...query,
    page: query.page === undefined ? undefined : Number(query.page),
    pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize) }; }
  private mapDaily(error: unknown): never { if (error instanceof DailyCollectionsValidationError) throw new BadRequestException(error.message); if (error instanceof DailyCollectionsForbiddenError) throw new ForbiddenException(error.message); throw error; }
  @Get('collection-agenda') @RequirePermissions('collection-agenda.view') async agenda(@Query() query: CollectionAgendaQueryDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.collectionAgenda!.execute({ ...query,
      page: query.page === undefined ? undefined : Number(query.page),
      pageSize: query.pageSize === undefined ? undefined : Number(query.pageSize) }, actor); }
    catch (error) { if (error instanceof CollectionAgendaValidationError) throw new BadRequestException(error.message);
      if (error instanceof CollectionAgendaForbiddenError) throw new ForbiddenException(error.message); throw error; }
  }
  @Get('portfolio-tracking') @RequirePermissions('payments.view') portfolioTracking(@Query() query: PortfolioTrackingQueryDto) {
    return this.portfolio!.execute({ search: query.search ?? '', status: query.status ?? 'ALL',
      collectionStatus: query.collectionStatus ?? 'ALL', position: Number(query.position ?? 1) }).catch((error) => this.map(error));
  }
  @Get('loans') @RequirePermissions('payments.view') loans(@Query() query: { search?: string; page?: string; pageSize?: string }) {
    const page = Number(query.page ?? 1); const pageSize = Number(query.pageSize ?? 20);
    return this.context.listLoans({ search: query.search, page: Number.isSafeInteger(page) && page > 0 ? page : 1, pageSize: Number.isSafeInteger(pageSize) && pageSize > 0 ? Math.min(100, pageSize) : 20 }).catch((error) => this.map(error));
  }
  @Get('loans/:loanId') @RequirePermissions('payments.view') detail(@Param('loanId') loanId: string) { return this.context.execute(loanId).catch((error) => this.map(error)); }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('payments.create') create(@Body() body: CreatePaymentDto, @CurrentUser() actor: CurrentIdentity) { return this.register.execute(body, actor.id).catch((error) => this.map(error)); }
  @Post(':paymentId/annul') @HttpCode(HttpStatus.CREATED) @RequirePermissions('payments.annul') annul(@Param('paymentId') paymentId: string, @Body() body: AnnulPaymentDto, @CurrentUser() actor: CurrentIdentity) { return this.register.annul(paymentId, body.reason, body.idempotencyKey, actor.id).catch((error) => this.map(error)); }
  @Put('loans/:loanId/plan') @RequirePermissions('payments.plan.customize') plan(@Param('loanId') loanId: string, @Body() body: CustomizePaymentPlanDto) { return this.customize.execute(loanId, body.entries, body.idempotencyKey, body.base).catch((error) => this.map(error)); }
  private map(error: unknown): never { if (error instanceof PaymentConflictError) throw new ConflictException(error.message); if (error instanceof PaymentValidationError) throw new BadRequestException(error.message); if (error instanceof PaymentNotFoundError) throw new NotFoundException(error.message); throw error; }
}
