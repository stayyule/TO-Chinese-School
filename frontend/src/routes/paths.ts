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

/** Route paths used for navigation; pages for registration and admin arrive with later tasks. */
export const PATHS = {
  home: '/',
  changePassword: '/account/password',
  parentFamily: '/parent/family',
  registrationPeople: '/registration/people',
  registrationNewFamily: '/registration/families/new',
  adminSchoolYears: '/admin/school-years',
  adminSchoolClasses: '/admin/school-classes',
  adminRoles: '/admin/roles',
  adminInvitations: '/admin/invitations',
} as const

export const familyAddressPath = (familyId: number) => `/parent/families/${familyId}/address`
export const addParentPath = (familyId: number) => `/parent/families/${familyId}/parents/new`
export const addChildPath = (familyId: number) => `/parent/families/${familyId}/children/new`
export const editPersonPath = (personId: number) => `/parent/people/${personId}/edit`
