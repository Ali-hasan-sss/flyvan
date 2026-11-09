import { describe, expect, it } from "vitest";
import { normalizeEmail, normalizePhone, parseLoginIdentifier } from "./identity";

describe("login identifiers", () => {
  it("normalizes email and phone before they are stored or matched", () => {
    expect(normalizeEmail("  Owner@Localhost.Test ")).toBe("owner@localhost.test");
    expect(normalizeEmail("not-an-email")).toBeNull();
    expect(normalizePhone(" 0999 123-456 ")).toBe("0999123456");
    expect(normalizePhone("+963 944 000 111")).toBe("+963944000111");
    expect(normalizePhone("12")).toBeNull();
  });

  it("treats an at-sign as an email and anything else as a phone", () => {
    expect(parseLoginIdentifier("Owner@Localhost.Test")).toEqual({
      kind: "email",
      value: "owner@localhost.test",
    });
    expect(parseLoginIdentifier("0999 123 456")).toEqual({
      kind: "phone",
      value: "0999123456",
    });
    expect(parseLoginIdentifier("bad@")).toBeNull();
  });
});
