import { hash, verify } from '@node-rs/argon2';

// §9.2: تجزئة كلمات المرور بـ Argon2id (توصيات OWASP: 19 MiB، تكرارين، خيط واحد).
const ARGON2ID = 2;
const options = { algorithm: ARGON2ID, memoryCost: 19_456, timeCost: 2, parallelism: 1 } as const;

export const MIN_PASSWORD_LENGTH = 10;
export const MAX_PASSWORD_LENGTH = 128;

export function hashPassword(password: string): Promise<string> {
  return hash(password, options);
}

export async function verifyPassword({
  hash: digest,
  password,
}: {
  hash: string;
  password: string;
}) {
  try {
    return await verify(digest, password);
  } catch {
    return false;
  }
}
