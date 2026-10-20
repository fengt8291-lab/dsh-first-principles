export function createSession(userId: string) {
  const ttl = 60 * 60 * 1000
  return { userId, expiresAt: Date.now() + ttl }
}

export function isExpired(session: { expiresAt: number }): boolean {
  return Date.now() > session.expiresAt
}
