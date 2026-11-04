import type { MenuProps } from 'antd'
import { t } from '../i18n'

export type MenuItem = Required<MenuProps>['items'][number]

/** Menu entries are shown only when the user holds the permission (UI hint; the API enforces access). */
export function menuItems(can: (code: string) => boolean): MenuItem[] {
  const items: MenuItem[] = [{ key: '/', label: t('nav.home') }]
  if (can('home.panel.student_parent')) items.push({ key: '/parent', label: t('nav.parent') })
  if (can('people.read')) items.push({ key: '/registration/people', label: t('nav.registration') })
  if (can('home.panel.accounting_officer')) items.push({ key: '/accounting', label: t('nav.accounting') })
  const admin: MenuItem[] = []
  if (can('school_years.read')) admin.push({ key: '/admin/school-years', label: t('nav.admin.schoolYears') })
  if (can('school_classes.read')) admin.push({ key: '/admin/school-classes', label: t('nav.admin.schoolClasses') })
  if (can('access.roles.read')) admin.push({ key: '/admin/roles', label: t('nav.admin.roles') })
  if (can('auth.invitations.create')) admin.push({ key: '/admin/invitations', label: t('nav.admin.invitations') })
  if (admin.length > 0) items.push({ key: '/admin', label: t('nav.admin'), children: admin })
  if (can('school_classes.read')) items.push({ key: '/instruction', label: t('nav.instruction') })
  if (can('home.panel.communication_officer')) items.push({ key: '/communication', label: t('nav.communication') })
  return items
}
