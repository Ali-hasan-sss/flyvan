import { SetMetadata } from "@nestjs/common";
import type { Permission } from "@flyvan/types";

export const PERMISSIONS_KEY = "flyvan:permissions";

export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
