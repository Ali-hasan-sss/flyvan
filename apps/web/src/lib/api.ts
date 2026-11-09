import { clearSession, readSession, writeSession, type Session } from "./session";

export function apiBaseUrl(): string {
  return process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:3001";
}

export async function loginRequest(identifier: string, password: string): Promise<Session> {
  const response = await fetch(`${apiBaseUrl()}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ identifier, password }),
  });
  if (!response.ok) {
    throw new Error(await readError(response, "تعذر تسجيل الدخول."));
  }
  const session = (await response.json()) as Session;
  writeSession(session);
  return session;
}

export async function logoutRequest(): Promise<void> {
  const session = readSession();
  clearSession();
  if (!session) {
    return;
  }
  await fetch(`${apiBaseUrl()}/api/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: session.refreshToken }),
  }).catch(() => undefined);
}

export async function apiRequest(path: string, init: RequestInit = {}, retry = true): Promise<Response> {
  const session = readSession();
  const headers = new Headers(init.headers);
  if (session && !headers.has("authorization")) {
    headers.set("authorization", `Bearer ${session.accessToken}`);
  }
  if (init.body && !(init.body instanceof FormData) && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await fetch(`${apiBaseUrl()}${path}`, { ...init, cache: init.cache ?? "no-store", headers });
  if (response.status !== 401 || !session || !retry) {
    return response;
  }

  const refreshed = await refreshSession(session.refreshToken);
  if (!refreshed) {
    clearSession();
    return response;
  }
  return apiRequest(path, init, false);
}

async function refreshSession(refreshToken: string): Promise<boolean> {
  const response = await fetch(`${apiBaseUrl()}/api/auth/refresh`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken }),
  });
  if (!response.ok) {
    return false;
  }
  writeSession((await response.json()) as Session);
  return true;
}

export async function readError(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    if (Array.isArray(body.message)) {
      return body.message.join(" ");
    }
    return body.message || fallback;
  } catch {
    return fallback;
  }
}
