import { BadRequestException, ConflictException, Controller, Get, Param, Post, Body, Query, Headers, HttpCode, HttpStatus } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CreateLoanUseCase, ListActiveLoanCustomersUseCase, ListLoansUseCase, LoanConflictError, LoanValidationError } from '../../application/loan/loan.use-case';
import { CreateLoanDto, LoanListQueryDto } from './loan.dto';
@Controller('loans') export class LoanController {
  constructor(private readonly create: CreateLoanUseCase, private readonly list: ListLoansUseCase, private readonly customers: ListActiveLoanCustomersUseCase) {}
  @Get('customer-options') @RequirePermissions('loans.create') customerOptions(@Query() query: { page?: string; pageSize?: string; search?: string }) { return this.customers.execute({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(20, Math.max(10, Number(query.pageSize) || 10)), search: query.search }); }
  @Get() @RequirePermissions('loans.view') listLoans(@Query() query: LoanListQueryDto) { return this.list.execute({ page: Math.max(1, Number(query.page) || 1), pageSize: Math.min(100, Math.max(20, Number(query.pageSize) || 20)), search: query.search, frequencyId: query.frequencyId, fromDate: query.fromDate, toDate: query.toDate, sortBy: query.sortBy, sortOrder: query.sortOrder }); }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('loans.create') async createLoan(@Body() body: CreateLoanDto, @Headers('idempotency-key') idempotencyKey: string | undefined, @CurrentUser() actor: CurrentIdentity) { try { return await this.create.execute({ ...body, idempotencyKey: idempotencyKey?.trim() || body.idempotencyKey }, actor.id); } catch (error) { if (error instanceof LoanConflictError) throw new ConflictException(error.message); if (error instanceof LoanValidationError) throw new BadRequestException(error.message); throw error; } }
  @Get(':id') @RequirePermissions('loans.view') async detail(@Param('id') id: string) { try { return await this.create.get(id); } catch (error) { if (error instanceof LoanValidationError) throw new BadRequestException(error.message); throw error; } }
}
