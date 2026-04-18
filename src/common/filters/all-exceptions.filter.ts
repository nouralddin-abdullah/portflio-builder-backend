import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { Logger } from 'nestjs-pino';
import { ZodError } from 'zod';
import { Sentry } from '../observability/sentry';
import type { ApiErrorBody } from '../http/api-response';

interface HttpExceptionShape {
  message?: string | string[];
  error?: string;
  code?: string;
  details?: unknown;
}

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  constructor(private readonly logger: Logger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const res = ctx.getResponse<Response>();
    const req = ctx.getRequest<Request>();

    const { status, body } = this.toErrorBody(exception);

    if (status >= 500) {
      this.logger.error(
        { err: exception, path: req.url, method: req.method },
        'Unhandled exception',
      );
      Sentry.captureException(exception);
    }

    res.status(status).json(body);
  }

  private toErrorBody(exception: unknown): { status: number; body: ApiErrorBody } {
    if (exception instanceof ZodError) {
      return {
        status: HttpStatus.UNPROCESSABLE_ENTITY,
        body: {
          error: {
            code: 'validation_error',
            message: 'Request failed validation.',
            details: this.flattenZod(exception),
          },
        },
      };
    }

    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const shape: HttpExceptionShape =
        typeof response === 'object' && response !== null ? (response as HttpExceptionShape) : {};
      const message = Array.isArray(shape.message)
        ? shape.message.join('; ')
        : shape.message ?? (typeof response === 'string' ? response : exception.message);
      const code =
        shape.code ??
        shape.error ??
        this.statusToCode(status);
      return {
        status,
        body: {
          error: {
            code,
            message,
            details: shape.details as Record<string, string> | undefined,
          },
        },
      };
    }

    return {
      status: HttpStatus.INTERNAL_SERVER_ERROR,
      body: {
        error: {
          code: 'internal_error',
          message: 'Internal server error.',
        },
      },
    };
  }

  private flattenZod(err: ZodError): Record<string, string> {
    const out: Record<string, string> = {};
    for (const issue of err.issues) {
      const path = issue.path.join('.') || '(root)';
      if (!out[path]) out[path] = issue.message;
    }
    return out;
  }

  private statusToCode(status: number): string {
    switch (status) {
      case 400:
        return 'bad_request';
      case 401:
        return 'unauthorized';
      case 403:
        return 'forbidden';
      case 404:
        return 'not_found';
      case 409:
        return 'conflict';
      case 422:
        return 'validation_error';
      case 429:
        return 'rate_limited';
      default:
        return status >= 500 ? 'internal_error' : 'error';
    }
  }
}
