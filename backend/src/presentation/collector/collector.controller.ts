import { BadRequestException, ConflictException, Controller, ForbiddenException, Get, InternalServerErrorException, NotFoundException, Param, ParseUUIDPipe, Patch, Post, Query, Res, UploadedFile, UseInterceptors, Body } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import type { Response } from 'express';
import { CollectorIdentificationAlreadyExistsError, CollectorNotFoundError, CollectorPhotoNotFoundError, CollectorUnauthorizedAssociationError, CollectorUserAlreadyLinkedError, CollectorUserNotEligibleError, CollectorValidationError } from '../../domain/collector/collector.errors';
import { CollectorUseCases } from '../../application/collector/collector.use-cases';
import { CollectorStatisticsUseCase } from '../../application/collector/collector-statistics.use-case';
import type { UploadFile } from '../../application/customer/file-storage';
import type { CurrentIdentity } from '../../domain/security/security.types';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import { CollectorListQueryDto, CollectorStatisticsQueryDto, CollectorStatusDto, CollectorUserDto, CreateCollectorDto, UpdateCollectorDto } from './collector.dto';
import { CollectorFinancialSummaryForbiddenError, CollectorFinancialSummaryIntegrityError, CollectorFinancialSummaryUseCase } from '../../application/collector/collector-financial-summary.use-case';

const mapError = (error: unknown): never => { if (error instanceof CollectorNotFoundError || error instanceof CollectorPhotoNotFoundError) throw new NotFoundException(error.message); if (error instanceof CollectorIdentificationAlreadyExistsError || error instanceof CollectorUserAlreadyLinkedError) throw new ConflictException(error.message); if (error instanceof CollectorUnauthorizedAssociationError) throw new ForbiddenException(error.message); if (error instanceof CollectorUserNotEligibleError || error instanceof CollectorValidationError) throw new BadRequestException(error.message); throw error; };
@Controller('collectors')
export class CollectorController {
  constructor(private readonly useCases: CollectorUseCases, private readonly statistics: CollectorStatisticsUseCase, private readonly financialSummary: CollectorFinancialSummaryUseCase) {}
  @Get('eligible-users') @RequirePermissions('collectors.user.assign') eligibleUsers() { return this.useCases.eligibleUsers(); }
  @Get('statistics') @RequirePermissions('payments.view') async getStatistics(@Query() query: CollectorStatisticsQueryDto) { try { return await this.statistics.execute(query.year, query.month); } catch (error) { return mapError(error); } }
  @Get('me/financial-summary') @RequirePermissions('collectors.financial-summary.view') async getFinancialSummary(@CurrentUser() actor: CurrentIdentity) {
    try { return await this.financialSummary.execute(actor); }
    catch (error) {
      if (error instanceof CollectorFinancialSummaryForbiddenError) throw new ForbiddenException(error.message);
      if (error instanceof CollectorFinancialSummaryIntegrityError) throw new InternalServerErrorException('No se pudo reconciliar la cartera activa asignada.');
      throw error;
    }
  }
  @Get() @RequirePermissions('collectors.view') list(@Query() query: CollectorListQueryDto) { return this.useCases.list({ search: query.search, status: query.status ?? 'ACTIVE', page: query.page ?? 1, pageSize: query.pageSize ?? 10 }); }
  @Get(':id/photo') @RequirePermissions('collectors.photo.view') async photo(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Res() response: Response) { try { const file = await this.useCases.photo(id); return response.type(file.mimetype).send(file.buffer); } catch (error) { return mapError(error); } }
  @Get(':id') @RequirePermissions('collectors.view') async detail(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { try { return await this.useCases.detail(id); } catch (error) { return mapError(error); } }
  @Post() @RequirePermissions('collectors.create') @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 }, storage: memoryStorage() })) async create(@Body() body: CreateCollectorDto, @UploadedFile() photo: Express.Multer.File | undefined, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.create(body as unknown as Record<string, unknown>, photo as UploadFile | undefined, actor.role.isSuperAdmin || actor.permissions.includes('collectors.user.assign')); } catch (error) { return mapError(error); } }
  @Patch(':id/status') @RequirePermissions('collectors.status.change') async status(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: CollectorStatusDto) { try { return await this.useCases.status(id, body.isActive); } catch (error) { return mapError(error); } }
  @Patch(':id/user') @RequirePermissions('collectors.user.assign') async user(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: CollectorUserDto) { try { return await this.useCases.linkUser(id, body.userId ?? null); } catch (error) { return mapError(error); } }
  @Patch(':id') @RequirePermissions('collectors.update') @UseInterceptors(FileInterceptor('photo', { limits: { fileSize: 5 * 1024 * 1024 }, storage: memoryStorage() })) async update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() body: UpdateCollectorDto, @UploadedFile() photo?: Express.Multer.File) { try { return await this.useCases.update(id, body as unknown as Record<string, unknown>, photo as UploadFile | undefined); } catch (error) { return mapError(error); } }
}
