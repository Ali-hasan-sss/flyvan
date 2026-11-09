import { USER_ROLES, type UserRole } from "@flyvan/types";
import type { PublicUser } from "../auth/public-user";

export type UserAdminCode =
  | "SELF_DISABLE"
  | "SELF_ROLE"
  | "LAST_OWNER"
  | "PASSWORD"
  | "IDENTIFIER"
  | "EMAIL"
  | "PHONE"
  | "ROLE"
  | "NAME"
  | "NOT_FOUND"
  | "DUPLICATE"
  | "EMPTY";

export class UserAdminError extends Error {
  constructor(readonly code: UserAdminCode) {
    super(code);
  }
}

export function assertCanDisable(actorId: string, target: PublicUser, activeOwners: number): void {
  if (actorId === target.id) {
    throw new UserAdminError("SELF_DISABLE");
  }
  if (target.role === "PLATFORM_OWNER" && target.status === "ACTIVE" && activeOwners <= 1) {
    throw new UserAdminError("LAST_OWNER");
  }
}

export function assertCanChangeRole(
  actorId: string,
  target: PublicUser,
  nextRole: UserRole,
  activeOwners: number,
): void {
  if (nextRole === target.role) {
    return;
  }
  if (actorId === target.id) {
    throw new UserAdminError("SELF_ROLE");
  }
  if (target.role === "PLATFORM_OWNER" && target.status === "ACTIVE" && activeOwners <= 1) {
    throw new UserAdminError("LAST_OWNER");
  }
}

export function assertRole(value: string): UserRole {
  if (!(USER_ROLES as readonly string[]).includes(value)) {
    throw new UserAdminError("ROLE");
  }
  return value as UserRole;
}

export function assertDisplayName(value: string): string {
  const name = value.trim();
  if (name.length < 2 || name.length > 80) {
    throw new UserAdminError("NAME");
  }
  return name;
}

export function assertPassword(value: string): void {
  if (value.length < 8 || value.length > 200) {
    throw new UserAdminError("PASSWORD");
  }
}
