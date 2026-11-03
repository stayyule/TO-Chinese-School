import { t, type MessageKey } from '../../i18n'
import { PATHS } from '../../routes/paths'

export interface Panel {
  permission: string
  title: string
  links: { label: string; to: string }[]
}

interface PanelDef {
  permission: string
  titleKey: MessageKey
  links: { labelKey: MessageKey; to: string }[]
}

/**
 * Home panels keyed by their home.panel.* permission. Only features that exist in this sub-project are linked;
 * links for later sub-projects (class counts, reports, withdrawals, library, track events...) are added with them.
 */
const DEFS: PanelDef[] = [
  {
    permission: 'home.panel.principal',
    titleKey: 'panel.principal',
    links: [
      { labelKey: 'link.schoolYears', to: PATHS.adminSchoolYears },
      { labelKey: 'link.roles', to: PATHS.adminRoles },
      { labelKey: 'link.invitations', to: PATHS.adminInvitations },
    ],
  },
  { permission: 'home.panel.academic_vice_principal', titleKey: 'panel.academic_vice_principal', links: [] },
  {
    permission: 'home.panel.registration_officer',
    titleKey: 'panel.registration_officer',
    links: [
      { labelKey: 'link.listPeople', to: PATHS.registrationPeople },
      { labelKey: 'link.registerFamily', to: PATHS.registrationNewFamily },
      { labelKey: 'link.schoolClasses', to: PATHS.adminSchoolClasses },
    ],
  },
  { permission: 'home.panel.accounting_officer', titleKey: 'panel.accounting_officer', links: [] },
  { permission: 'home.panel.activity_officer', titleKey: 'panel.activity_officer', links: [] },
  { permission: 'home.panel.communication_officer', titleKey: 'panel.communication_officer', links: [] },
  {
    permission: 'home.panel.instruction_officer',
    titleKey: 'panel.instruction_officer',
    links: [
      { labelKey: 'link.listPeople', to: PATHS.registrationPeople },
      { labelKey: 'link.schoolClasses', to: PATHS.adminSchoolClasses },
    ],
  },
  { permission: 'home.panel.instructor', titleKey: 'panel.instructor', links: [] },
  { permission: 'home.panel.pva', titleKey: 'panel.pva', links: [] },
  {
    permission: 'home.panel.student_parent',
    titleKey: 'panel.student_parent',
    links: [
      { labelKey: 'link.myFamily', to: PATHS.parentFamily },
      { labelKey: 'link.changePassword', to: PATHS.changePassword },
    ],
  },
]

export const PANELS: Panel[] = DEFS.map((d) => ({
  permission: d.permission,
  title: t(d.titleKey),
  links: d.links.map((l) => ({ label: t(l.labelKey), to: l.to })),
}))
