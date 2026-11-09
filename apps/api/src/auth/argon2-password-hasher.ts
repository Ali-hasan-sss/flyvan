import { Injectable } from "@nestjs/common";
import argon2 from "argon2";
import type { PasswordHasher } from "./password-hasher";

@Injectable()
export class Argon2PasswordHasher implements PasswordHasher {
  hash(plain: string): Promise<string> {
    return argon2.hash(plain, { type: argon2.argon2id });
  }

  async verify(passwordHash: string, plain: string): Promise<boolean> {
    try {
      return await argon2.verify(passwordHash, plain);
    } catch {
      return false;
    }
  }
}
