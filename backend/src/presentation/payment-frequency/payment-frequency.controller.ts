import { BadRequestException, ConflictException, Controller, Get, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Body } from '@nestjs/common';
import { PaymentFrequencyNameAlreadyExistsError, PaymentFrequencyNotFoundError } from '../../domain/payment-frequency/payment-frequency.errors';
import { ChangePaymentFrequencyStatusUseCase, CreatePaymentFrequencyUseCase, GetPaymentFrequencyUseCase, ListPaymentFrequenciesUseCase, UpdatePaymentFrequencyUseCase } from '../../application/payment-frequency/payment-frequency.use-cases';
import { ChangePaymentFrequencyStatusDto, CreatePaymentFrequencyDto, UpdatePaymentFrequencyDto } from './payment-frequency.dto';
import { RequirePermissions } from '../security/security.decorators';

@Controller('payment-frequencies')
export class PaymentFrequencyController {
  constructor(private readonly list: ListPaymentFrequenciesUseCase, private readonly get: GetPaymentFrequencyUseCase, private readonly create: CreatePaymentFrequencyUseCase, private readonly update: UpdatePaymentFrequencyUseCase, private readonly status: ChangePaymentFrequencyStatusUseCase) {}
  @Get() @RequirePermissions('payment-frequencies.view') listAll() { return this.list.execute(); }
  @Get(':id') @RequirePermissions('payment-frequencies.view') getOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.run(() => this.get.execute(id)); }
  @Post() @RequirePermissions('payment-frequencies.create') createOne(@Body() body: CreatePaymentFrequencyDto) { return this.run(() => this.create.execute(body)); }
  @Patch(':id') @RequirePermissions('payment-frequencies.update') updateOne(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdatePaymentFrequencyDto) { return this.run(() => this.update.execute(id, body)); }
  @Patch(':id/status') @RequirePermissions('payment-frequencies.status.change') changeStatus(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: ChangePaymentFrequencyStatusDto) { return this.run(() => this.status.execute(id, body.isActive)); }
  private async run<T>(operation: () => Promise<T>): Promise<T> { try { return await operation(); } catch (error) { if (error instanceof PaymentFrequencyNotFoundError) throw new NotFoundException(error.message); if (error instanceof PaymentFrequencyNameAlreadyExistsError) throw new ConflictException(error.message); if (error instanceof Error) throw new BadRequestException(error.message); throw error; } }
}
