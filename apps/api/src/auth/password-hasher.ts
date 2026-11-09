export interface PasswordHasher {
  hash(plain: string): Promise<string>;
  verify(passwordHash: string, plain: string): Promise<boolean>;
}
