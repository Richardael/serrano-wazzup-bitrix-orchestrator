import { createHash, timingSafeEqual } from "crypto";

export function bearerTokenMatches(
  authorization: string | undefined,
  expected: string | undefined,
): boolean {
  if (!authorization || !expected) return false;
  const match = /^Bearer (.+)$/.exec(authorization);
  if (!match) return false;
  const receivedToken = match[1];
  if (!receivedToken) return false;

  const receivedDigest = createHash("sha256").update(receivedToken).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(receivedDigest, expectedDigest);
}
