import {
  BadRequestException,
  Catch,
  type ArgumentsHost,
  type ExceptionFilter,
  HttpException,
  HttpStatus,
  type INestApplication,
  Logger,
  ValidationPipe,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { Request, Response } from 'express';
import type { ValidationError } from 'class-validator';

export type ApiErrorCode = 'VALIDATION_FAILED' | 'AUTHENTICATION_REQUIRED' | 'PERMISSION_DENIED' |
  'RESOURCE_NOT_FOUND' | 'RESOURCE_STATE_CONFLICT' | 'INTERNAL_ERROR';

export type ApiFieldError = { field: string; codes: string[]; message: string };
export type ApiErrorResponse = {
  statusCode: number;
  message: string;
  errorCode: string;
  reasonCode?: string;
  data?: { fields: ApiFieldError[] };
  requestId: string;
};

type DiagnosticLogger = { error(message: string, stack?: string): void };
type ErrorBody = { message?: unknown; errorCode?: unknown; reasonCode?: unknown; data?: unknown };

const statusCodes: Record<number, ApiErrorCode> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'AUTHENTICATION_REQUIRED',
  [HttpStatus.FORBIDDEN]: 'PERMISSION_DENIED',
  [HttpStatus.NOT_FOUND]: 'RESOURCE_NOT_FOUND',
  [HttpStatus.CONFLICT]: 'RESOURCE_STATE_CONFLICT',
};

const statusMessages: Record<number, string> = {
  [HttpStatus.BAD_REQUEST]: 'La solicitud contiene datos inválidos. Revisa la información e intenta nuevamente.',
  [HttpStatus.UNAUTHORIZED]: 'Tu sesión no es válida. Inicia sesión nuevamente.',
  [HttpStatus.FORBIDDEN]: 'No tienes permiso para realizar esta operación.',
  [HttpStatus.NOT_FOUND]: 'La información solicitada no está disponible.',
  [HttpStatus.CONFLICT]: 'La operación no pudo completarse porque la información cambió. Actualiza los datos e intenta nuevamente.',
  [HttpStatus.INTERNAL_SERVER_ERROR]: 'No se pudo completar la operación. Intenta nuevamente o contacta a soporte.',
};

const validationCodes: Record<string, string> = {
  isDefined: 'REQUIRED', isNotEmpty: 'REQUIRED', isString: 'INVALID_TYPE', isUUID: 'INVALID_FORMAT',
  matches: 'INVALID_FORMAT', isDateString: 'INVALID_DATE', isIn: 'INVALID_OPTION', maxLength: 'TOO_LONG',
  minLength: 'TOO_SHORT', isNumber: 'INVALID_NUMBER', isInt: 'INVALID_NUMBER', isArray: 'INVALID_TYPE',
  isObject: 'INVALID_TYPE', whitelistValidation: 'UNKNOWN_FIELD',
};

const fieldMessages: Record<string, string> = {
  REQUIRED: 'Este campo es obligatorio.',
  INVALID_DATE: 'Ingresa una fecha válida.',
  INVALID_OPTION: 'Selecciona una opción válida.',
  INVALID_NUMBER: 'Ingresa un número válido.',
  TOO_LONG: 'El valor supera la longitud permitida.',
  TOO_SHORT: 'El valor no alcanza la longitud mínima.',
  UNKNOWN_FIELD: 'Este campo no está permitido.',
  INVALID_TYPE: 'El tipo de valor no es válido.',
  INVALID_FORMAT: 'El formato ingresado no es válido.',
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);
const validCode = (value: unknown): value is string => typeof value === 'string' && /^[A-Z][A-Z0-9_]{2,80}$/.test(value);

function flattenValidationErrors(errors: ValidationError[], parent = ''): ApiFieldError[] {
  return errors.flatMap((error) => {
    const field = parent ? `${parent}.${error.property}` : error.property;
    const codes = [...new Set(Object.keys(error.constraints ?? {}).map((constraint) => validationCodes[constraint] ?? 'INVALID_VALUE'))];
    return [
      ...(codes.length ? [{ field, codes, message: fieldMessages[codes[0]] ?? 'El valor ingresado no es válido.' }] : []),
      ...flattenValidationErrors(error.children ?? [], field),
    ];
  });
}

export function createValidationException(errors: ValidationError[]): BadRequestException {
  return new BadRequestException({
    message: 'Revisa los campos indicados antes de continuar.',
    errorCode: 'VALIDATION_FAILED',
    data: { fields: flattenValidationErrors(errors) },
  });
}

function safeValidationData(value: unknown): { fields: ApiFieldError[] } | undefined {
  if (!isRecord(value) || !Array.isArray(value.fields)) return undefined;
  const fields = value.fields.flatMap((item): ApiFieldError[] => {
    if (!isRecord(item) || typeof item.field !== 'string' || typeof item.message !== 'string' ||
      !Array.isArray(item.codes) || !item.codes.every(validCode)) return [];
    return [{ field: item.field, codes: item.codes, message: item.message }];
  });
  return fields.length ? { fields } : undefined;
}

function bodyOf(exception: HttpException): ErrorBody {
  const response = exception.getResponse();
  return typeof response === 'string' ? { message: response } : isRecord(response) ? response : {};
}

function messageOf(status: number, body: ErrorBody): string {
  if (status === HttpStatus.UNAUTHORIZED || status === HttpStatus.FORBIDDEN || status >= 500) {
    return statusMessages[status] ?? statusMessages[HttpStatus.INTERNAL_SERVER_ERROR];
  }
  const raw = Array.isArray(body.message)
    ? body.message.filter((item): item is string => typeof item === 'string').join(' ')
    : typeof body.message === 'string' ? body.message : '';
  if (!raw || /^Cannot\s+(GET|POST|PUT|PATCH|DELETE)\b/i.test(raw) || /^Validation failed\b/i.test(raw)) {
    return statusMessages[status] ?? 'No se pudo completar la solicitud.';
  }
  return raw;
}

function requestIdFrom(request: Request): string {
  const candidate = request.headers['x-request-id'];
  return typeof candidate === 'string' && /^[A-Za-z0-9._-]{1,128}$/.test(candidate) ? candidate : randomUUID();
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  constructor(private readonly logger: DiagnosticLogger = new Logger(ApiExceptionFilter.name)) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const requestId = requestIdFrom(request);
    const httpException = exception instanceof HttpException ? exception : undefined;
    const status = httpException?.getStatus() ?? HttpStatus.INTERNAL_SERVER_ERROR;
    const body = httpException ? bodyOf(httpException) : {};
    const reasonCode = validCode(body.reasonCode) ? body.reasonCode : undefined;
    const errorCode = validCode(body.errorCode) ? body.errorCode : statusCodes[status] ?? 'INTERNAL_ERROR';
    const data = safeValidationData(body.data);
    const payload: ApiErrorResponse = {
      statusCode: status,
      message: messageOf(status, body),
      errorCode,
      ...(reasonCode && { reasonCode }),
      ...(data && { data }),
      requestId,
    };
    if (!httpException || status >= 500) {
      const stack = exception instanceof Error ? exception.stack : undefined;
      this.logger.error(`Unhandled HTTP error [${requestId}] ${request.method} ${request.originalUrl ?? request.url}`, stack);
    }
    response.setHeader('X-Request-Id', requestId);
    response.status(status).json(payload);
  }
}

export function configureHttpErrorHandling(app: INestApplication, logger?: DiagnosticLogger): void {
  app.useGlobalFilters(new ApiExceptionFilter(logger));
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    exceptionFactory: createValidationException,
  }));
}
