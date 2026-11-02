import {
  createParamDecorator,
  Inject,
  Injectable,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from "@nestjs/common";
import { fromNodeHeaders } from "better-auth/node";
import type { Request } from "express";
import { AUTH } from "./auth.module.js";
import type { Auth } from "./auth.js";

export type AuthedRequest = Request & { userId?: string };

/** Only reads the Better Auth session: no session, no access (401). Sets `request.userId` for `@UserId()`. */
@Injectable()
export class SessionGuard implements CanActivate {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthedRequest>();
    const session = await this.auth.api.getSession({ headers: fromNodeHeaders(request.headers) });
    if (!session) {
      throw new UnauthorizedException();
    }
    request.userId = session.user.id;
    return true;
  }
}

export const UserId = createParamDecorator((_data: unknown, context: ExecutionContext): string => {
  const userId = context.switchToHttp().getRequest<AuthedRequest>().userId;
  if (!userId) {
    throw new UnauthorizedException();
  }
  return userId;
});
