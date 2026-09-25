import { BadRequestException, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Body } from '@nestjs/common';
import { PaymentMethodNameAlreadyExistsError, PaymentMethodNotFoundError } from '../../domain/payment-method/payment-method.errors';
import { ChangePaymentMethodStatusUseCase, CreatePaymentMethodUseCase, GetPaymentMethodUseCase, ListPaymentMethodsUseCase, UpdatePaymentMethodUseCase } from '../../application/payment-method/payment-method.use-cases';
import { ChangePaymentMethodStatusDto, CreatePaymentMethodDto, UpdatePaymentMethodDto } from './payment-method.dto';
import { RequirePermissions } from '../security/security.decorators';

@Controller('payment-methods')
export class PaymentMethodController {
  constructor(private readonly list: ListPaymentMethodsUseCase, private readonly get: GetPaymentMethodUseCase, private readonly create: CreatePaymentMethodUseCase, private readonly update: UpdatePaymentMethodUseCase, private readonly status: ChangePaymentMethodStatusUseCase) {}
  @Get() @RequirePermissions('payment-methods.view') listAll() { return this.list.execute(); }
  @Get(':id') @RequirePermissions('payment-methods.view') getOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.run(() => this.get.execute(id)); }
  @Post() @RequirePermissions('payment-methods.create') createOne(@Body() body: CreatePaymentMethodDto) { return this.run(() => this.create.execute(body)); }
  @Patch(':id') @RequirePermissions('payment-methods.update') updateOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdatePaymentMethodDto) { return this.run(() => this.update.execute(id, body)); }
  @Patch(':id/status') @RequirePermissions('payment-methods.status.change') changeStatus(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: ChangePaymentMethodStatusDto) { return this.run(() => this.status.execute(id, body.isActive)); }
  private async run<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { if (error instanceof PaymentMethodNotFoundError) throw new NotFoundException(error.message); if (error instanceof PaymentMethodNameAlreadyExistsError) throw new ConflictException(error.message); if (error instanceof Error) throw new BadRequestException(error.message); throw error; } }
}
