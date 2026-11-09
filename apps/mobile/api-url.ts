import Constants from "expo-constants";
import { NativeModules } from "react-native";

const configuredApiUrl = () => (process.env.EXPO_PUBLIC_API_URL ?? "http://localhost:3001").replace(/\/$/, "");

export function resolveApiUrl(): string {
  const configured = configuredApiUrl();
  const devHost = developmentHostname();
  if (!devHost) return configured;
  try {
    const url = new URL(configured);
    if (isLocalHostname(url.hostname)) {
      url.hostname = devHost;
      return url.toString().replace(/\/$/, "");
    }
  } catch {
    return `http://${devHost}:3001`;
  }
  return configured;
}

function developmentHostname(): string {
  const candidates = [
    bundleScriptUrl(),
    Constants.expoConfig?.hostUri,
    Constants.expoGoConfig?.debuggerHost,
    Constants.experienceUrl,
    Constants.linkingUri,
  ];
  for (const value of candidates) {
    const host = hostnameFrom(value);
    if (host && !isLoopback(host)) return host;
  }
  return "";
}

function bundleScriptUrl(): string {
  const source = (NativeModules as { SourceCode?: { scriptURL?: string } } | undefined)?.SourceCode?.scriptURL;
  return source ?? "";
}

function hostnameFrom(value: string | null | undefined): string {
  if (!value) return "";
  const withScheme = value.includes("://") ? value : `http://${value}`;
  try {
    return new URL(withScheme).hostname;
  } catch {
    const match = /^[a-z][a-z0-9+.-]*:\/\/([^/:]+)/i.exec(value) ?? /^([^/:]+)/.exec(value);
    return match?.[1] ?? "";
  }
}

function isLoopback(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return host === "localhost" || host === "127.0.0.1" || host === "0.0.0.0" || host === "::1";
}

function isLocalHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();
  if (isLoopback(host) || host.endsWith(".local")) return true;
  const parts = host.split(".");
  if (parts.length !== 4) return false;
  const numbers = parts.map((part) => Number(part));
  if (numbers.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = numbers;
  if (first === 10 || first === 127) return true;
  if (first === 192 && second === 168) return true;
  if (first === 172 && second !== undefined && second >= 16 && second <= 31) return true;
  return false;
}
