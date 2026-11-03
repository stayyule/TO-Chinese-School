/** Public (unauthenticated) route patterns; everything else requires a signed-in user. */
const PUBLIC_PATTERNS: RegExp[] = [
  /^\/signin\/?$/,
  /^\/register\/?$/,
  /^\/forgot-password\/?$/,
  /^\/forgot-username\/?$/,
  /^\/reset-password\/[^/]+\/?$/,
  /^\/register-with-invitation\/[^/]+\/?$/,
]

export function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATTERNS.some((p) => p.test(pathname))
}
