import { BadRequestException, ConflictException, Controller, Get, NotFoundException, Param, Post, Put, Body, Query, HttpCode, HttpStatus } from '@nestjs/common';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CustomizePaymentPlanUseCase, PaymentConflictError, PaymentContextUseCase, PaymentNotFoundError, PaymentValidationError, RegisterPaymentUseCase } from '../../application/payment/payment.use-case';
import { AnnulPaymentDto, CreatePaymentDto, CustomizePaymentPlanDto } from './payment.dto';

@Controller('payments')
export class PaymentController {
  constructor(private readonly register: RegisterPaymentUseCase, private readonly context: PaymentContextUseCase, private readonly customize: CustomizePaymentPlanUseCase) {}
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
