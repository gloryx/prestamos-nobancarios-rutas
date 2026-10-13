import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  type INestApplication,
  Module,
  NotFoundException,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { IsString } from 'class-validator';
import type { AddressInfo } from 'net';
import { configureHttpErrorHandling, type ApiErrorResponse } from '../src/presentation/shared/http-error-handling';

class ValidationBody { @IsString() name!: string; }

@Controller('test-errors')
class ErrorTestController {
  @Post('validation') validation(@Body() body: ValidationBody) { return body; }
  @Get('bad-request') badRequest() { throw new BadRequestException('Mensaje compatible existente.'); }
  @Get('unauthorized') unauthorized() { throw new UnauthorizedException(); }
  @Get('forbidden') forbidden() { throw new ForbiddenException(); }
  @Get('not-found') notFound() { throw new NotFoundException('Recurso específico no encontrado.'); }
  @Get('conflict') conflict() { throw new ConflictException({ message: 'Conflicto compatible existente.', reasonCode: 'STALE_DATA' }); }
  @Get('unexpected') unexpected() { throw new Error('private SQL constraint users_email_key'); }
}

@Module({ controllers: [ErrorTestController] })
class ErrorTestModule {}

describe('global HTTP error boundary', () => {
  let app: INestApplication;
  let baseUrl: string;
  const logger = { error: jest.fn() };

  beforeAll(async () => {
    app = (await Test.createTestingModule({ imports: [ErrorTestModule] }).compile()).createNestApplication();
    configureHttpErrorHandling(app, logger);
    await app.listen(0, '127.0.0.1');
    const address = app.getHttpServer().address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => app.close());

  const read = async (path: string, init?: RequestInit) => {
    const response = await fetch(`${baseUrl}${path}`, init);
    return { response, body: await response.json() as ApiErrorResponse };
  };

  it('returns Spanish structured field validation without class-validator text', async () => {
    const { response, body } = await read('/test-errors/validation', {
      method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Request-Id': 'validation-test' }, body: '{}',
    });
    expect(response.status).toBe(400);
    expect(response.headers.get('x-request-id')).toBe('validation-test');
    expect(body).toEqual({ statusCode: 400, message: 'Revisa los campos indicados antes de continuar.',
      errorCode: 'VALIDATION_FAILED', data: { fields: [{ field: 'name', codes: ['INVALID_TYPE'],
        message: 'El tipo de valor no es válido.' }] }, requestId: 'validation-test' });
  });

  it.each([
    ['/test-errors/bad-request', 400, 'VALIDATION_FAILED'],
    ['/test-errors/unauthorized', 401, 'AUTHENTICATION_REQUIRED'],
    ['/test-errors/forbidden', 403, 'PERMISSION_DENIED'],
    ['/test-errors/not-found', 404, 'RESOURCE_NOT_FOUND'],
    ['/test-errors/conflict', 409, 'RESOURCE_STATE_CONFLICT'],
  ])('normalizes %s as HTTP %i', async (path, status, errorCode) => {
    const { response, body } = await read(path as string);
    expect(response.status).toBe(status);
    expect(body).toMatchObject({ statusCode: status, errorCode });
    expect(body.requestId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('preserves existing reasonCode and compatible business messages', async () => {
    const { body } = await read('/test-errors/conflict');
    expect(body).toMatchObject({ message: 'Conflicto compatible existente.', reasonCode: 'STALE_DATA' });
  });

  it('returns 500 and logs diagnostics without exposing SQL, constraints or stacks', async () => {
    const { response, body } = await read('/test-errors/unexpected');
    expect(response.status).toBe(500);
    expect(body).toMatchObject({ statusCode: 500, errorCode: 'INTERNAL_ERROR',
      message: 'No se pudo completar la operación. Intenta nuevamente o contacta a soporte.' });
    expect(JSON.stringify(body)).not.toMatch(/SQL|constraint|users_email_key|stack/i);
    expect(logger.error).toHaveBeenCalledWith(expect.stringContaining('GET /test-errors/unexpected'),
      expect.stringContaining('private SQL constraint users_email_key'));
  });

  it('sanitizes framework 404 messages for unknown routes', async () => {
    const { response, body } = await read('/missing-route');
    expect(response.status).toBe(404);
    expect(body).toMatchObject({ errorCode: 'RESOURCE_NOT_FOUND', message: 'La información solicitada no está disponible.' });
    expect(body.message).not.toContain('Cannot GET');
  });
});
