import * as SecureStore from "expo-secure-store";
import { resolveApiUrl } from "./api-url";

const storageKey = "flyvan.driver.session";

type SavedSession = {
  refreshToken: string;
  displayName: string;
};

export type DriverSession = {
  accessToken: string;
  apiUrl: string;
};

let accessToken: string | null = null;
let refreshToken: string | null = null;
let restoring: Promise<{ displayName: string } | null> | null = null;

export function getDriverSession(): DriverSession | null {
  if (!accessToken) return null;
  return { accessToken, apiUrl: resolveApiUrl() };
}

export async function driverFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const session = getDriverSession();
  if (!session) throw new Error("no-session");
  const response = await send(session, path, init);
  if (response.status !== 401) return response;
  const restored = await restoreOnce();
  if (!restored) return response;
  const next = getDriverSession();
  if (!next) return response;
  return send(next, path, init);
}

async function send(session: DriverSession, path: string, init: RequestInit): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.accessToken}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  return fetch(`${session.apiUrl}${path}`, { ...init, headers });
}

export async function saveDriverLogin(input: { accessToken: string; refreshToken: string; displayName: string }): Promise<void> {
  accessToken = input.accessToken;
  refreshToken = input.refreshToken;
  await writeSaved({ refreshToken: input.refreshToken, displayName: input.displayName });
}

export function restoreDriverLogin(): Promise<{ displayName: string } | null> {
  restoring ??= restoreOnce().finally(() => {
    restoring = null;
  });
  return restoring;
}

export async function clearDriverLogin(): Promise<void> {
  const token = refreshToken ?? (await readSaved())?.refreshToken ?? null;
  const apiUrl = resolveApiUrl();
  accessToken = null;
  refreshToken = null;
  await SecureStore.deleteItemAsync(storageKey).catch(() => undefined);
  if (!token) return;
  await fetch(`${apiUrl}/api/auth/logout`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ refreshToken: token }),
  }).catch(() => undefined);
}

async function restoreOnce(): Promise<{ displayName: string } | null> {
  const saved = await readSaved();
  if (!saved) return null;
  try {
    const response = await fetch(`${resolveApiUrl()}/api/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: saved.refreshToken }),
    });
    if (response.status === 401) {
      accessToken = null;
      refreshToken = null;
      await SecureStore.deleteItemAsync(storageKey).catch(() => undefined);
      return null;
    }
    if (!response.ok) return null;
    const body = (await response.json()) as { accessToken?: string; refreshToken?: string; user?: { displayName?: string } };
    if (!body.accessToken || !body.refreshToken) return null;
    const displayName = body.user?.displayName || saved.displayName;
    accessToken = body.accessToken;
    refreshToken = body.refreshToken;
    await writeSaved({ refreshToken: body.refreshToken, displayName });
    return { displayName };
  } catch {
    return null;
  }
}

async function readSaved(): Promise<SavedSession | null> {
  const raw = await SecureStore.getItemAsync(storageKey);
  if (!raw) return null;
  try {
    const saved = JSON.parse(raw) as SavedSession;
    if (!saved.refreshToken || !saved.displayName) return null;
    return saved;
  } catch {
    return null;
  }
}

async function writeSaved(saved: SavedSession): Promise<void> {
  await SecureStore.setItemAsync(storageKey, JSON.stringify(saved));
}
