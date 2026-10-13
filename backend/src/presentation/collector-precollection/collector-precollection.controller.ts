import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
} from '@nestjs/common';
import type { CurrentIdentity } from '../../domain/security/security.types';
import {
  CollectorPrecollectionConflictError,
  CollectorPrecollectionForbiddenError,
  CollectorPrecollectionNotFoundError,
  CollectorPrecollectionValidationError,
} from '../../domain/collector-precollection/collector-precollection.errors';
import {
  CancelCollectorPrecollectionUseCase,
  CreateCollectorPrecollectionUseCase,
  GetCollectorPrecollectionDetailUseCase,
  ListCollectorPrecollectionsUseCase,
  ListMyCollectorPrecollectionsUseCase,
} from '../../application/collector-precollection/collector-precollection.use-cases';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import {
  CancelCollectorPrecollectionDto,
  CollectorPrecollectionListQueryDto,
  CreateCollectorPrecollectionDto,
} from './collector-precollection.dto';

@Controller('collector-precollections')
export class CollectorPrecollectionController {
  constructor(
    private readonly createUseCase: CreateCollectorPrecollectionUseCase,
    private readonly mineUseCase: ListMyCollectorPrecollectionsUseCase,
    private readonly listUseCase: ListCollectorPrecollectionsUseCase,
    private readonly detailUseCase: GetCollectorPrecollectionDetailUseCase,
    private readonly cancelUseCase: CancelCollectorPrecollectionUseCase,
  ) {}

  private query(value: CollectorPrecollectionListQueryDto) {
    return { ...value, page: value.page === undefined ? undefined : Number(value.page),
      pageSize: value.pageSize === undefined ? undefined : Number(value.pageSize) };
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @RequirePermissions('collector-precollections.create')
  async create(@Body() body: CreateCollectorPrecollectionDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.createUseCase.execute(body, actor); } catch (error) { return this.map(error); }
  }

  @Get('mine')
  @RequirePermissions('collector-precollections.assigned.view')
  async mine(@Query() query: CollectorPrecollectionListQueryDto, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.mineUseCase.execute(this.query(query), actor); } catch (error) { return this.map(error); }
  }

  @Get()
  @RequirePermissions('collector-precollections.view')
  async list(@Query() query: CollectorPrecollectionListQueryDto) {
    try { return await this.listUseCase.execute(this.query(query)); } catch (error) { return this.map(error); }
  }

  @Get(':id')
  @RequirePermissions()
  async detail(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() actor: CurrentIdentity) {
    try { return await this.detailUseCase.execute(id, actor); } catch (error) { return this.map(error); }
  }

  @Post(':id/cancel')
  @RequirePermissions('collector-precollections.cancel')
  async cancel(@Param('id', ParseUUIDPipe) id: string, @Body() body: CancelCollectorPrecollectionDto,
    @CurrentUser() actor: CurrentIdentity) {
    try { return await this.cancelUseCase.execute(id, body.reason, body.idempotencyKey, actor); }
    catch (error) { return this.map(error); }
  }

  private map(error: unknown): never {
    if (error instanceof CollectorPrecollectionValidationError) {
      throw new BadRequestException({ message: error.message, errorCode: 'VALIDATION_FAILED', reasonCode: error.reasonCode,
        ...(error.field && { data: { fields: [{ field: error.field, codes: [error.reasonCode], message: error.message }] } }) });
    }
    if (error instanceof CollectorPrecollectionConflictError) {
      throw new ConflictException({ message: error.message, errorCode: 'RESOURCE_STATE_CONFLICT', reasonCode: error.reasonCode });
    }
    if (error instanceof CollectorPrecollectionNotFoundError) throw new NotFoundException(error.message);
    if (error instanceof CollectorPrecollectionForbiddenError) throw new ForbiddenException(error.message);
    throw error;
  }
}
