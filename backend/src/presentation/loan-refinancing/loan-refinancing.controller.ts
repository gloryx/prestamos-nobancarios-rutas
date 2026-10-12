import { BadRequestException, ConflictException, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, ParseUUIDPipe, Post, Body, Query } from '@nestjs/common';
import { LoanRefinancingUseCase, RefinancingConflictError, RefinancingNotFoundError, RefinancingValidationError } from '../../application/loan-refinancing/refinancing.use-case';
import { LoanRefinancingAnnulmentUseCase, RefinancingAnnulmentConflictError, RefinancingAnnulmentNotFoundError, RefinancingAnnulmentValidationError } from '../../application/loan-refinancing/refinancing-annulment.use-case';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { AnnulLoanRefinancingDto, ConfirmLoanRefinancingDto, ListAnnullableRefinancingsDto, ListLoanRefinancingsDto, ListRefinancingAnnulmentsDto, PreviewLoanRefinancingDto, SearchLoanRefinancingsDto } from './loan-refinancing.dto';
import { refinancingResponse } from './loan-refinancing.response';

@Controller('loan-refinancings')
export class LoanRefinancingController {
  constructor(private readonly useCase: LoanRefinancingUseCase,
    private readonly annulments: LoanRefinancingAnnulmentUseCase) {}

  @Get() @RequirePermissions('loans.refinance.view')
  async list(@Query() query: ListLoanRefinancingsDto) {
    try { return await this.useCase.list({ search: query.search, customerId: query.customerId,
      dateFrom: query.dateFrom, dateTo: query.dateTo,
      page: query.page ? Number(query.page) : 1, pageSize: query.pageSize ? Number(query.pageSize) : 20 }); }
    catch (error) { return this.map(error); }
  }

  @Get('loans') @RequirePermissions('loans.refinance.view')
  async search(@Query() query: SearchLoanRefinancingsDto) {
    try { return await this.useCase.search({ search: query.search, page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 20 }); }
    catch (error) { return this.map(error); }
  }

  @Get('loans/:loanId/preview') @RequirePermissions('loans.refinance.view')
  async preview(@Param('loanId', ParseUUIDPipe) id: string, @Query() query: PreviewLoanRefinancingDto) {
    try { return await this.useCase.preview(id, query.refinancingDate); } catch (error) { return this.map(error); }
  }

  @Get('loans/:loanId/chain') @RequirePermissions('loans.refinance.view')
  async chain(@Param('loanId', ParseUUIDPipe) id: string) {
    try { return await this.useCase.chain(id); } catch (error) { return this.map(error); }
  }

  @Get('customers/:customerId/chains') @RequirePermissions('loans.refinance.view')
  async chainsForCustomer(@Param('customerId', ParseUUIDPipe) id: string) {
    try { return await this.useCase.chainsForCustomer(id); } catch (error) { return this.map(error); }
  }

  @Get('annulled') @RequirePermissions('loans.refinance.view')
  async annulled(@Query() query: ListRefinancingAnnulmentsDto) {
    try { return await this.annulments.annulled({ search: query.search, dateFrom: query.dateFrom, dateTo: query.dateTo,
      page: query.page ? Number(query.page) : 1, pageSize: query.pageSize ? Number(query.pageSize) : 20,
      sortBy: query.sortBy, sortDir: query.sortDir }); }
    catch (error) { return this.map(error); }
  }

  @Get('annullable') @RequirePermissions('loans.refinance.view')
  async annullable(@Query() query: ListAnnullableRefinancingsDto) {
    try { return await this.annulments.annullable({ search: query.search, dateFrom: query.dateFrom, dateTo: query.dateTo,
      effectiveDate: query.effectiveDate, page: query.page ? Number(query.page) : 1,
      pageSize: query.pageSize ? Number(query.pageSize) : 20, sortBy: query.sortBy, sortDir: query.sortDir }); }
    catch (error) { return this.map(error); }
  }

  @Get('annulment-payment-methods') @RequirePermissions('loans.refinance.view')
  paymentMethods() { return this.annulments.paymentMethods(); }

  @Get('annulments/:annulmentId') @RequirePermissions('loans.refinance.view')
  async annulmentDetail(@Param('annulmentId', ParseUUIDPipe) id: string) {
    try { return await this.annulments.detail(id); } catch (error) { return this.map(error); }
  }

  @Post(':refinancingId/annul') @HttpCode(HttpStatus.CREATED) @RequirePermissions('loans.refinance.annul')
  async annul(@Param('refinancingId', ParseUUIDPipe) id: string, @Body() body: AnnulLoanRefinancingDto,
    @CurrentUser() actor: CurrentIdentity) {
    try { return await this.annulments.annul(id, body, actor.id); } catch (error) { return this.map(error); }
  }

  @Get(':id') @RequirePermissions('loans.refinance.view')
  async detail(@Param('id', ParseUUIDPipe) id: string) {
    try { return refinancingResponse(await this.useCase.detail(id)); } catch (error) { return this.map(error); }
  }

  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('loans.refinance.create')
  async confirm(@Body() body: ConfirmLoanRefinancingDto, @CurrentUser() actor: CurrentIdentity) {
    try { return refinancingResponse(await this.useCase.confirm(body, actor.id)); } catch (error) { return this.map(error); }
  }

  private map(error: unknown): never {
    if (error instanceof RefinancingValidationError || error instanceof RefinancingAnnulmentValidationError)
      throw new BadRequestException(error.message);
    if (error instanceof RefinancingNotFoundError || error instanceof RefinancingAnnulmentNotFoundError)
      throw new NotFoundException(error.message);
    if (error instanceof RefinancingConflictError || error instanceof RefinancingAnnulmentConflictError)
      throw new ConflictException({ message: error.message, reasonCode: error.reasonCode });
    throw error;
  }
}
