import type { UserRole } from "@flyvan/types";

export type PublicUser = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: UserRole;
  status: "ACTIVE" | "DISABLED";
};

export type SessionUser = PublicUser & {
  passwordHash: string;
};

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: PublicUser;
};

export function toPublicUser(user: SessionUser): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    displayName: user.displayName,
    role: user.role,
    status: user.status,
  };
}
