import {
  CanActivate,
  createParamDecorator,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { IS_PUBLIC } from "./public.decorator";
import type { PublicUser } from "./public-user";
import { InvalidCredentialsError, SessionService } from "./session.service";

type AuthenticatedRequest = {
  headers: { authorization?: string };
  user?: PublicUser;
};

@Injectable()
export class AccessGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly sessions: SessionService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("يلزم تسجيل الدخول.");
    }

    try {
      request.user = await this.sessions.readAccess(header.slice("Bearer ".length).trim());
      return true;
    } catch (error) {
      if (error instanceof InvalidCredentialsError) {
        throw new UnauthorizedException("يلزم تسجيل الدخول.");
      }
      throw error;
    }
  }
}

export const CurrentUser = createParamDecorator((_: unknown, context: ExecutionContext): PublicUser => {
  const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
  if (!request.user) {
    throw new UnauthorizedException("يلزم تسجيل الدخول.");
  }
  return request.user;
});
