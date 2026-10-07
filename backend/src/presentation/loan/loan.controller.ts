import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, Param, Patch, Post, Body, Query, Headers, HttpCode, HttpStatus, InternalServerErrorException, NotFoundException, Optional, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase, LoanConflictError, LoanValidationError } from '../../application/loan/loan.use-case';
import { CancelledLoansValidationError, ListCancelledLoansUseCase } from '../../application/loan/cancelled-loans.use-case';
import { MarkUncollectibleConflictError, MarkUncollectibleNotFoundError, MarkUncollectibleUseCase, MarkUncollectibleValidationError } from '../../application/loan/mark-uncollectible.use-case';
import { ReactivateLoanConflictError, ReactivateLoanNotFoundError, ReactivateLoanUseCase, ReactivateLoanValidationError } from '../../application/loan/reactivate-loan.use-case';
import { ListOverdueLoansUseCase, OverdueLoansValidationError } from '../../application/loan/overdue-loans.use-case';
import { ListUncollectibleLoansUseCase, UncollectibleLoansIntegrityError, UncollectibleLoansValidationError } from '../../application/loan/uncollectible-loans.use-case';
import { EditLoanUseCase, LoanEditConflictError, LoanEditNotFoundError, LoanEditValidationError } from '../../application/loan/edit-loan.use-case';
import { GetLoanEditContextUseCase, LoanEditContextConflictError, LoanEditContextNotFoundError } from '../../application/loan/loan-edit-context.use-case';
import { LoanEditInputError, normalizeLoanEditCommand } from '../../application/loan/loan-edit.command';
import { LoanEditIdempotencyConflictError, LoanEditIdempotencyInputError } from '../../infrastructure/database/typeorm/repositories/loan-edit-operations.repository';
import { AnnulLoanUseCase, AnnulLoanConflictError, AnnulLoanIntegrityError, AnnulLoanNotFoundError, AnnulLoanValidationError } from '../../application/loan/annul-loan.use-case';
import { ListAnnulledLoansUseCase, AnnulledLoansIntegrityError, AnnulledLoansValidationError } from '../../application/loan/annulled-loans.use-case';
import { PaymentConflictError, PaymentValidationError } from '../../application/payment/payment.errors';
import { AnnulledLoansQueryDto, AnnulLoanDto, CancelledLoansQueryDto, CreateLoanDto, LoanEditDto, LoanListQueryDto, MarkUncollectibleDto, OverdueLoansQueryDto, ReactivateLoanDto, UncollectibleLoansQueryDto } from './loan.dto';
import { ActiveLoanExportIntegrityError, ExportActiveLoansUseCase } from '../../application/loan/export-active-loans.use-case';
import { AssignedLoansForbiddenError, AssignedLoansUseCase, AssignedLoansValidationError } from '../../application/loan/assigned-loans.use-case';
import { AssignedLoanListQueryDto } from './loan.dto';
@Controller('loans') export class LoanController {
  constructor(private readonly create: CreateLoanUseCase, private readonly list: ListLoansUseCase, private readonly customers: ListActiveLoanCustomersUseCase, private readonly cancelled: ListCancelledLoansUseCase, private readonly markUncollectible: MarkUncollectibleUseCase, private readonly reactivateLoan: ReactivateLoanUseCase, private readonly overdue?: ListOverdueLoansUseCase, private readonly uncollectible?: ListUncollectibleLoansUseCase, private readonly edit?: EditLoanUseCase, private readonly editContext?: GetLoanEditContextUseCase, @Optional() private readonly annulList?: ListAnnulledLoansUseCase, @Optional() private readonly annul?: AnnulLoanUseCase, @Optional() private readonly exportActive?: ExportActiveLoansUseCase, @Optional() private readonly assigned?: AssignedLoansUseCase) {}
  @Get('customer-options') @RequirePermissions('loans.create') customerOptions(@Query() query: { page?: string; pageSize?: string; search?: string }) { return this.customers.execute({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(20, Math.max(10, Number(query.pageSize) || 10)), search: query.search }); }
  @Get('assigned') @RequirePermissions('loans.assigned.view') async assignedLoans(@Query() query: AssignedLoanListQueryDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.assigned!.list({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(20, Number(query.pageSize) || 20)), search: query.search, frequencyId: query.frequencyId, fromDate: query.fromDate, toDate: query.toDate, sortBy: query.sortBy, sortOrder: query.sortOrder, status: query.status }, actor); }
    catch (error) { return this.mapAssigned(error); }
  }
  @Get('assigned/:id') @RequirePermissions('loans.assigned.view') async assignedLoanDetail(@Param('id', new ParseUUIDPipe()) id: string, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.assigned!.detail(id, actor); }
    catch (error) { return this.mapAssigned(error); }
  }
  private mapAssigned(error: unknown): never { if (error instanceof AssignedLoansValidationError) throw new BadRequestException(error.message); if (error instanceof AssignedLoansForbiddenError) throw new ForbiddenException(error.message); throw error; }
  @Get() @RequirePermissions('loans.view') listLoans(@Query() query: LoanListQueryDto) { return this.list.execute({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(20, Number(query.pageSize) || 20)), search: query.search, frequencyId: query.frequencyId, fromDate: query.fromDate, toDate: query.toDate, sortBy: query.sortBy, sortOrder: query.sortOrder }); }
  @Get('summary') @RequirePermissions('loans.view') async activeLoanSummary() {
    return this.readActivePortfolio(() => this.exportActive!.executeSummary());
  }
  @Get('export') @RequirePermissions('loans.export') async exportActiveLoans() {
    return this.readActivePortfolio(() => this.exportActive!.execute());
  }
  private async readActivePortfolio<T>(read: () => Promise<T>) {
    try { return await read(); }
    catch (error) {
      if (error instanceof ActiveLoanExportIntegrityError) throw new InternalServerErrorException('No se pudieron reconciliar los saldos de los préstamos activos.');
      throw error;
    }
  }
  @Get('cancelled') @RequirePermissions('loans.view') async cancelledLoans(@Query() query: CancelledLoansQueryDto) {
    try { return await this.cancelled.execute({ page: query.page ? Number(query.page) : 1, pageSize: query.pageSize ? Number(query.pageSize) : 20,
      search: query.search, startDate: query.startDate, endDate: query.endDate, sortBy: query.sortBy, sortDirection: query.sortDirection }); }
    catch (error) { if (error instanceof CancelledLoansValidationError) throw new BadRequestException(error.message); throw error; }
  }
  @Get('overdue') @RequirePermissions('loans.view') async overdueLoans(@Query() query: OverdueLoansQueryDto) {
    try { return await this.overdue!.execute({ page: query.page ? Number(query.page) : 1, pageSize: query.pageSize ? Number(query.pageSize) : 20,
      search: query.search, startDate: query.startDate, endDate: query.endDate, sortBy: query.sortBy, sortDir: query.sortDir }); }
    catch (error) { if (error instanceof OverdueLoansValidationError) throw new BadRequestException(error.message); throw error; }
  }
  @Get('uncollectible') @RequirePermissions('loans.view') async uncollectibleLoans(@Query() query: UncollectibleLoansQueryDto) {
    try { return await this.uncollectible!.execute({ page: query.page ? Number(query.page) : 1, pageSize: query.pageSize ? Number(query.pageSize) : 20,
      search: query.search, startDate: query.startDate, endDate: query.endDate, sortBy: query.sortBy, sortDir: query.sortDir }); }
    catch (error) {
      if (error instanceof UncollectibleLoansValidationError) throw new BadRequestException(error.message);
      if (error instanceof UncollectibleLoansIntegrityError) throw new InternalServerErrorException('No se pudo consultar la integridad de los préstamos incobrables.');
      throw error;
    }
  }
  @Get('annullable') @RequirePermissions('loans.view') async annullableLoans(@Query() query: AnnulledLoansQueryDto) { return this.annulledLoans('annullable', query); }
  @Get('annulled') @RequirePermissions('loans.view') async annulledLoansList(@Query() query: AnnulledLoansQueryDto) { return this.annulledLoans('annulled', query); }
  private async annulledLoans(kind: 'annullable' | 'annulled', query: AnnulledLoansQueryDto) {
    try { return await this.annulList!.execute(kind, { ...query, page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 20 }); }
    catch (error) {
      if (error instanceof AnnulledLoansValidationError) throw new BadRequestException(error.message);
      if (error instanceof AnnulledLoansIntegrityError) throw new InternalServerErrorException('No se pudo verificar la integridad de los préstamos.');
      throw new InternalServerErrorException('No se pudo consultar los préstamos.');
    }
  }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('loans.create') async createLoan(@Body() body: CreateLoanDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @CurrentUser() actor: CurrentIdentity) { try { return await this.create.execute({ ...body, idempotencyKey: idempotencyKey?.trim() || body.idempotencyKey }, actor.id); } catch (error) { if (error instanceof LoanConflictError) throw new ConflictException(error.message); if (error instanceof LoanValidationError) throw new BadRequestException(error.message); throw error; } }
  @Post(':id/uncollectible') @RequirePermissions('loans.status.uncollectible') async markAsUncollectible(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: MarkUncollectibleDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.markUncollectible.execute(id, body, actor.id); }
    catch (error) {
      if (error instanceof MarkUncollectibleValidationError) throw new BadRequestException(error.message);
      if (error instanceof MarkUncollectibleNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof MarkUncollectibleConflictError) throw new ConflictException(error.message);
      throw new InternalServerErrorException('No se pudo actualizar el estado del préstamo.');
    }
  }
  @Post(':id/reactivate') @RequirePermissions('loans.status.reactivate') async reactivate(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: ReactivateLoanDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.reactivateLoan.execute(id, body, actor.id); }
    catch (error) {
      if (error instanceof ReactivateLoanValidationError) throw new BadRequestException(error.message);
      if (error instanceof ReactivateLoanNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof ReactivateLoanConflictError) throw new ConflictException(error.message);
      throw new InternalServerErrorException('No se pudo actualizar el estado del préstamo.');
    }
  }
  @Post(':id/annul') @RequirePermissions('loans.status.annul') async annulLoan(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: AnnulLoanDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.annul!.execute(id, body, actor.id); }
    catch (error) {
      if (error instanceof AnnulLoanValidationError) throw new BadRequestException(error.message);
      if (error instanceof AnnulLoanNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof AnnulLoanConflictError) throw new ConflictException(error.message);
      if (error instanceof AnnulLoanIntegrityError) throw new InternalServerErrorException(error.message);
      throw new InternalServerErrorException('No se pudo anular el préstamo.');
    }
  }
  @Get(':id') @RequirePermissions('loans.view') async detail(@Param('id') id: string) { try { return await this.create.get(id); } catch (error) { if (error instanceof LoanValidationError) throw new BadRequestException(error.message); throw error; } }
  @Patch(':id') @HttpCode(HttpStatus.OK) @RequirePermissions('loans.update') async editLoan(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: LoanEditDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.edit!.execute(normalizeLoanEditCommand(body, id, actor.id)); }
    catch (error) {
      if (error instanceof LoanEditInputError || error instanceof LoanEditValidationError || error instanceof LoanEditIdempotencyInputError || error instanceof PaymentValidationError) throw new BadRequestException(error.message);
      if (error instanceof LoanEditNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof LoanEditConflictError || error instanceof LoanEditIdempotencyConflictError || error instanceof PaymentConflictError) throw new ConflictException(error.message);
      throw new InternalServerErrorException('Unable to edit the loan.');
    }
  }
  @Get(':id/edit-context') @RequirePermissions('loans.update') async getEditContext(@Param('id', new ParseUUIDPipe()) id: string) {
    try { return await this.editContext!.execute(id); }
    catch (error) {
      if (error instanceof LoanEditContextNotFoundError) throw new NotFoundException(error.message);
      if (error instanceof LoanEditContextConflictError) throw new ConflictException(error.message);
      throw new InternalServerErrorException('Unable to load the loan edit context.');
    }
  }
}
