import { BadRequestException, Body, ConflictException, Controller, ForbiddenException, Get, NotFoundException, Param, Patch, Post, UploadedFiles, UseInterceptors } from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { memoryStorage } from 'multer';
import { CurrentUser, RequirePermissions } from '../security/security.decorators';
import type { CurrentIdentity } from '../../domain/security/security.types';
import type { UploadFile } from '../../application/customer/file-storage';
import { CustomerSiteBadRequestError, CustomerSiteConflictError, CustomerSiteForbiddenError, CustomerSiteNotFoundError } from '../../domain/customer-site/customer-site.errors';
import { CustomerSiteUseCases } from '../../application/customer-site/customer-site.use-cases';
import { CreateSiteAuthorizationDto } from './customer-site.dto';

const handle = (error: unknown): never => {
  if (error instanceof CustomerSiteNotFoundError) throw new NotFoundException(error.message);
  if (error instanceof CustomerSiteForbiddenError) throw new ForbiddenException(error.message);
  if (error instanceof CustomerSiteConflictError) throw new ConflictException(error.message);
  if (error instanceof CustomerSiteBadRequestError) throw new BadRequestException(error.message);
  throw error;
};
const coordinate = (body: Record<string, unknown>, name: string): number | undefined => {
  if (!Object.prototype.hasOwnProperty.call(body, name)) return undefined;
  const value = body[name];
  if (value === null || value === '' || value === undefined) throw new CustomerSiteBadRequestError('No se permite eliminar una coordenada.');
  const result = Number(value);
  if (!Number.isFinite(result)) throw new CustomerSiteBadRequestError('Las coordenadas no son válidas.');
  return result;
};

@Controller('customers')
export class CustomerSiteController {
  constructor(private readonly useCases: CustomerSiteUseCases) {}
  @Get('assigned') @RequirePermissions('customers.assigned.view') async assigned(@CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.assignedCustomers(actor); } catch (error) { return handle(error); } }
  @Get(':id/site-assigned-collectors') @RequirePermissions('customers.site.replace.authorize') async assignedCollectors(@Param('id') id: string, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.assignedCollectors(id, actor); } catch (error) { return handle(error); } }
  @Get(':id/site') @RequirePermissions('customers.site.view', 'customers.view') async read(@Param('id') id: string, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.site(id, actor); } catch (error) { return handle(error); } }
  @Patch(':id/site') @RequirePermissions('customers.site.capture', 'customers.site.replace') @UseInterceptors(FileFieldsInterceptor([{ name: 'propertyPhoto', maxCount: 1 }], { limits: { fileSize: 5 * 1024 * 1024 }, storage: memoryStorage() })) async update(@Param('id') id: string, @Body() body: Record<string, unknown>, @UploadedFiles() files: { propertyPhoto?: Express.Multer.File[] }, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.update(id, { latitude: coordinate(body, 'latitude'), longitude: coordinate(body, 'longitude'), propertyPhoto: files?.propertyPhoto?.[0] as UploadFile }, actor); } catch (error) { return handle(error); } }
  @Post(':id/site-update-authorizations') @RequirePermissions('customers.site.replace.authorize') async authorize(@Param('id') id: string, @Body() body: CreateSiteAuthorizationDto, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.authorize(id, body, actor); } catch (error) { return handle(error); } }
  @Get(':id/site-update-authorizations') @RequirePermissions('customers.site.replace.authorize') async listAuthorizations(@Param('id') id: string, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.list(id, actor); } catch (error) { return handle(error); } }
  @Patch(':id/site-update-authorizations/:authorizationId/revoke') @RequirePermissions('customers.site.replace.authorize') async revoke(@Param('id') id: string, @Param('authorizationId') authorizationId: string, @CurrentUser() actor: CurrentIdentity) { try { return await this.useCases.revoke(id, authorizationId, actor); } catch (error) { return handle(error); } }
}
