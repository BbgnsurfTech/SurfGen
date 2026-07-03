import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import { Catch, HttpException, HttpStatus } from '@nestjs/common';
import type { FastifyReply } from 'fastify';
import { isDomainError, type ErrorCode } from '@surfgen/core';

const STATUS_BY_CODE: Record<ErrorCode, HttpStatus> = {
  VALIDATION_ERROR: HttpStatus.BAD_REQUEST,
  NOT_FOUND: HttpStatus.NOT_FOUND,
  CONFLICT: HttpStatus.CONFLICT,
  UNAUTHORIZED: HttpStatus.UNAUTHORIZED,
  FORBIDDEN: HttpStatus.FORBIDDEN,
  QUOTA_EXCEEDED: HttpStatus.PAYMENT_REQUIRED,
  RATE_LIMITED: HttpStatus.TOO_MANY_REQUESTS,
  PROVIDER_ERROR: HttpStatus.BAD_GATEWAY,
  PROVIDER_UNAVAILABLE: HttpStatus.SERVICE_UNAVAILABLE,
  PIPELINE_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  INVALID_STATE_TRANSITION: HttpStatus.CONFLICT,
  CONFIGURATION_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
  STORAGE_ERROR: HttpStatus.BAD_GATEWAY,
  INTERNAL_ERROR: HttpStatus.INTERNAL_SERVER_ERROR,
};

/** Maps DomainError codes and HttpExceptions to the API envelope. */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const reply = host.switchToHttp().getResponse<FastifyReply>();

    if (isDomainError(exception)) {
      const status = STATUS_BY_CODE[exception.code] ?? HttpStatus.INTERNAL_SERVER_ERROR;
      void reply.status(status).send({
        success: false,
        data: null,
        error: { code: exception.code, message: exception.message, details: exception.details },
      });
      return;
    }

    if (exception instanceof HttpException) {
      const response = exception.getResponse();
      const body = typeof response === 'string' ? { message: response } : (response as object);
      void reply.status(exception.getStatus()).send({
        success: false,
        data: null,
        error: { code: 'HTTP_ERROR', ...body },
      });
      return;
    }

    void reply.status(HttpStatus.INTERNAL_SERVER_ERROR).send({
      success: false,
      data: null,
      error: { code: 'INTERNAL_ERROR', message: 'Internal server error' },
    });
  }
}
