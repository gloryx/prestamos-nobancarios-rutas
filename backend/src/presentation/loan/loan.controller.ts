import { BadRequestException, ConflictException, Controller, Get, Param, Post, Body, Query, Headers, HttpCode, HttpStatus, InternalServerErrorException, NotFoundException, ParseUUIDPipe } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase, LoanConflictError, LoanValidationError } from '../../application/loan/loan.use-case';
import { CancelledLoansValidationError, ListCancelledLoansUseCase } from '../../application/loan/cancelled-loans.use-case';
import { MarkUncollectibleConflictError, MarkUncollectibleNotFoundError, MarkUncollectibleUseCase, MarkUncollectibleValidationError } from '../../application/loan/mark-uncollectible.use-case';
import { ReactivateLoanConflictError, ReactivateLoanNotFoundError, ReactivateLoanUseCase, ReactivateLoanValidationError } from '../../application/loan/reactivate-loan.use-case';
import { ListOverdueLoansUseCase, OverdueLoansValidationError } from '../../application/loan/overdue-loans.use-case';
import { ListUncollectibleLoansUseCase, UncollectibleLoansIntegrityError, UncollectibleLoansValidationError } from '../../application/loan/uncollectible-loans.use-case';
import { CancelledLoansQueryDto, CreateLoanDto, LoanListQueryDto, MarkUncollectibleDto, OverdueLoansQueryDto, ReactivateLoanDto, UncollectibleLoansQueryDto } from './loan.dto';
@Controller('loans') export class LoanController {
  constructor(private readonly create: CreateLoanUseCase, private readonly list: ListLoansUseCase, private readonly customers: ListActiveLoanCustomersUseCase, private readonly cancelled: ListCancelledLoansUseCase, private readonly markUncollectible: MarkUncollectibleUseCase, private readonly reactivateLoan: ReactivateLoanUseCase, private readonly overdue?: ListOverdueLoansUseCase, private readonly uncollectible?: ListUncollectibleLoansUseCase) {}
  @Get('customer-options') @RequirePermissions('loans.create') customerOptions(@Query() query: { page?: string; pageSize?: string; search?: string }) { return this.customers.execute({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(20, Math.max(10, Number(query.pageSize) || 10)), search: query.search }); }
  @Get() @RequirePermissions('loans.view') listLoans(@Query() query: LoanListQueryDto) { return this.list.execute({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(20, Number(query.pageSize) || 20)), search: query.search, frequencyId: query.frequencyId, fromDate: query.fromDate, toDate: query.toDate, sortBy: query.sortBy, sortOrder: query.sortOrder }); }
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
  @Get(':id') @RequirePermissions('loans.view') async detail(@Param('id') id: string) { try { return await this.create.get(id); } catch (error) { if (error instanceof LoanValidationError) throw new BadRequestException(error.message); throw error; } }
}
