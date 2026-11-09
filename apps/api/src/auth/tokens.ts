import { createHash, randomBytes, randomUUID } from "node:crypto";
import jwt from "jsonwebtoken";

export function hashToken(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function newRefreshSecret(): { id: string; raw: string; hash: string } {
  const raw = randomBytes(32).toString("base64url");
  return { id: randomUUID(), raw, hash: hashToken(raw) };
}

export function signAccessToken(input: {
  userId: string;
  secret: string;
  ttlSeconds: number;
}): string {
  return jwt.sign({ typ: "access" }, input.secret, {
    subject: input.userId,
    expiresIn: input.ttlSeconds,
    algorithm: "HS256",
  });
}

export function readAccessSubject(token: string, secret: string): string {
  const payload = jwt.verify(token, secret, { algorithms: ["HS256"] });
  if (typeof payload === "string" || payload.typ !== "access" || typeof payload.sub !== "string") {
    throw new Error("INVALID_ACCESS");
  }
  return payload.sub;
}
