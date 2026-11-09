export type SessionUser = {
  id: string;
  email: string | null;
  phone: string | null;
  displayName: string;
  role: string;
  status: "ACTIVE" | "DISABLED";
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: SessionUser;
};

const storageKey = "flyvan.session";

export function readSession(): Session | null {
  if (typeof window === "undefined") {
    return null;
  }
  const raw = window.sessionStorage.getItem(storageKey);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as Session;
    if (!parsed.accessToken || !parsed.refreshToken || !parsed.user?.id) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeSession(session: Session): void {
  window.sessionStorage.setItem(storageKey, JSON.stringify(session));
}

export function clearSession(): void {
  window.sessionStorage.removeItem(storageKey);
}
