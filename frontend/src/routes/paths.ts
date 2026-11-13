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

/** Route paths used for navigation. */
export const PATHS = {
  home: '/',
  changePassword: '/account/password',
  parentFamily: '/parent/family',
  registrationPeople: '/registration/people',
  registrationNewFamily: '/registration/families/new',
  adminSchoolYears: '/admin/school-years',
  adminSchoolYearNew: '/admin/school-years/new',
  adminSchoolClasses: '/admin/school-classes',
  adminSchoolClassNew: '/admin/school-classes/new',
  adminRoles: '/admin/roles',
  adminInvitations: '/admin/invitations',
} as const

export const familyAddressPath = (familyId: number) => `/parent/families/${familyId}/address`
export const addParentPath = (familyId: number) => `/parent/families/${familyId}/parents/new`
export const addChildPath = (familyId: number) => `/parent/families/${familyId}/children/new`
export const editPersonPath = (personId: number) => `/parent/people/${personId}/edit`

export const staffPersonPath = (personId: number) => `/registration/people/${personId}`
export const staffFamilyPath = (familyId: number) => `/registration/families/${familyId}`
export const schoolYearEditPath = (id: number) => `/admin/school-years/${id}/edit`
export const bookChargesPath = (id: number) => `/admin/school-years/${id}/book-charges`
export const schoolClassEditPath = (id: number) => `/admin/school-classes/${id}/edit`
export const roleDetailPath = (id: number) => `/admin/roles/${id}`
