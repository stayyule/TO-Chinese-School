/** English message catalog. Add a sibling catalog (e.g. zh-TW) with the same keys to localize. */
export const en = {
  'app.name': 'Thousand Oaks Chinese School',
  'common.loading': 'Loading...',
  'common.signIn': 'Sign in',
  'common.signOut': 'Sign out',
  'nav.home': 'Home',
  'nav.parent': 'Parent',
  'nav.registration': 'Registration',
  'nav.accounting': 'Accounting',
  'nav.admin': 'Administration',
  'nav.instruction': 'Instruction',
  'nav.communication': 'Communication',
  'nav.admin.schoolYears': 'School years',
  'nav.admin.roles': 'Roles',
  'signin.title': 'Sign in',
  'signin.username': 'Username',
  'signin.password': 'Password',
  'signin.failed': 'Sign in failed',
  'notFound.title': 'Page not found',
  'notFound.body': 'The page you requested does not exist.',
  'placeholder.comingSoon': 'This section is not available yet.',
} as const

export type MessageKey = keyof typeof en
