import { BadRequestException, Body, ConflictException, Controller, Get, HttpCode, HttpStatus, NotFoundException, Param, Post, Query } from '@nestjs/common';
import { FinancialCloseUseCases } from '../../application/financial-close/financial-close.use-cases';
import { FinancialCloseConflictError, FinancialCloseIntegrityError, FinancialCloseNotFoundError, FinancialCloseValidationError } from '../../domain/financial-close/financial-close.errors';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import { ConfirmFinancialCloseDto, FinancialClosePeriodDto, ListFinancialClosesDto } from './financial-close.dto';

@Controller('financial-closes')
export class FinancialCloseController {
  constructor(private readonly useCases: FinancialCloseUseCases) {}
  @Get('preview') @RequirePermissions('financial-closes.view')
  async preview(@Query() query: FinancialClosePeriodDto) { try { return await this.useCases.preview(query.period); } catch (error) { this.map(error); } }
  @Post() @HttpCode(HttpStatus.CREATED) @RequirePermissions('financial-closes.confirm')
  async confirm(@Body() body: ConfirmFinancialCloseDto, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.confirm(body.period, actor.id); } catch (error) { this.map(error); } }
  @Get() @RequirePermissions('financial-closes.view')
  list(@Query() query: ListFinancialClosesDto) { return this.useCases.list(query.page, query.pageSize); }
  @Get(':id') @RequirePermissions('financial-closes.view')
  async detail(@Param('id') id: string) { try { return await this.useCases.detail(id); } catch (error) { this.map(error); } }
  private map(error: unknown): never {
    if (error instanceof FinancialCloseValidationError) throw new BadRequestException(error.message);
    if (error instanceof FinancialCloseConflictError || error instanceof FinancialCloseIntegrityError) throw new ConflictException(error.message);
    if (error instanceof FinancialCloseNotFoundError) throw new NotFoundException(error.message);
    throw error;
  }
}
