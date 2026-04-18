import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export interface AuthPrincipal {
  userId: string;
  sessionId: string;
}

export type AuthenticatedRequest = Request & { user?: AuthPrincipal };

/** Injects the JWT-authenticated principal into a controller handler. */
export const CurrentUser = createParamDecorator<keyof AuthPrincipal | undefined>(
  (field, ctx: ExecutionContext) => {
    const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    const user = req.user;
    if (!user) throw new Error('CurrentUser requested on an unauthenticated request');
    return field ? user[field] : user;
  },
);
