import { CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Permission, UserRole } from "@flyvan/types";
import { PrismaService } from "../prisma/prisma.service";
import { decisionFor } from "./access-policy";
import { PERMISSIONS_KEY } from "./permissions.decorator";
import type { PublicUser } from "./public-user";
import { IS_PUBLIC } from "./public.decorator";

@Injectable()
export class PrismaPermissionCatalog {
  constructor(private readonly prisma: PrismaService) {}

  async grantsFor(role: UserRole): Promise<string[]> {
    const rows = await this.prisma.client.rolePermission.findMany({ where: { role } });
    return rows.map((row: { permission: string }) => row.permission);
  }
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly catalog: PrismaPermissionCatalog,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, [context.getHandler(), context.getClass()])) {
      return true;
    }

    const required =
      this.reflector.getAllAndOverride<Permission[]>(PERMISSIONS_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? [];
    if (required.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<{ user?: PublicUser }>();
    const user = request.user;
    if (!user) {
      throw new UnauthorizedException("يلزم تسجيل الدخول.");
    }

    const granted = await this.catalog.grantsFor(user.role);
    if (
      decisionFor({
        authenticated: true,
        active: user.status === "ACTIVE",
        granted,
        required,
      }) !== "ok"
    ) {
      throw new ForbiddenException("ليست لديك صلاحية لهذا الإجراء.");
    }
    return true;
  }
}
