import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, map } from 'rxjs';
import { isWrappedResponse, type ApiErrorBody, type ApiOk } from '../http/api-response';

type Wrapped = ApiOk<unknown> | ApiErrorBody;

@Injectable()
export class SerializationInterceptor implements NestInterceptor {
  intercept(_ctx: ExecutionContext, next: CallHandler): Observable<Wrapped> {
    return next.handle().pipe(
      map((payload: unknown): Wrapped => {
        if (payload === undefined || payload === null) return { data: null };
        if (isWrappedResponse(payload)) return payload;
        return { data: payload };
      }),
    );
  }
}
