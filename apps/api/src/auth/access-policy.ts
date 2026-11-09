import type { Permission } from "@flyvan/types";

export type AccessDecision = "ok" | "unauthenticated" | "forbidden";

export function decisionFor(input: {
  authenticated: boolean;
  active: boolean;
  granted: readonly string[];
  required: readonly Permission[];
}): AccessDecision {
  if (!input.authenticated || !input.active) {
    return "unauthenticated";
  }
  if (input.required.length === 0) {
    return "ok";
  }
  return input.required.every((permission) => input.granted.includes(permission))
    ? "ok"
    : "forbidden";
}
