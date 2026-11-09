import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { colors } from "./tokens";

const required = {
  primary: "#38BDF8",
  primaryStrong: "#0284C7",
  page: "#F4FAFF",
  card: "#FFFFFF",
  ink: "#0F2742",
  muted: "#64748B",
  line: "#DCECF8",
} as const;

describe("design tokens", () => {
  it("keeps the required Fly Van colors in TypeScript and CSS", () => {
    const css = readFileSync(new URL("./tokens.css", import.meta.url), "utf8").toLowerCase();

    for (const [key, value] of Object.entries(required)) {
      expect(colors[key as keyof typeof required]).toBe(value);
      expect(css).toContain(value.toLowerCase());
    }

    expect(colors.success).not.toBe(colors.primary);
    expect(colors.warning).not.toBe(colors.danger);
  });
});
