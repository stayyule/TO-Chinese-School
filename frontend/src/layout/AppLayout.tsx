import { Button, Layout, Menu, Space, Typography, type MenuProps } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuthActions, useMe } from '../auth/useMe'
import { t } from '../i18n'

type Item = Required<MenuProps>['items'][number]

/** Menu entries are shown only when the user holds the permission (UI hint; the API enforces access). */
export function AppLayout() {
  const { me, can } = useMe()
  const { clear } = useAuthActions()
  const location = useLocation()
  const navigate = useNavigate()

  const items: Item[] = [{ key: '/', label: t('nav.home') }]
  if (can('home.panel.student_parent')) items.push({ key: '/parent', label: t('nav.parent') })
  if (can('families.read')) items.push({ key: '/registration', label: t('nav.registration') })
  if (can('home.panel.accounting_officer')) items.push({ key: '/accounting', label: t('nav.accounting') })
  const adminChildren: Item[] = []
  if (can('school_years.read')) adminChildren.push({ key: '/admin/school-years', label: t('nav.admin.schoolYears') })
  if (can('access.roles.read')) adminChildren.push({ key: '/admin/roles', label: t('nav.admin.roles') })
  if (adminChildren.length > 0) items.push({ key: '/admin', label: t('nav.admin'), children: adminChildren })
  if (can('school_classes.read')) items.push({ key: '/instruction', label: t('nav.instruction') })
  if (can('home.panel.communication_officer')) items.push({ key: '/communication', label: t('nav.communication') })

  const selected = items
    .flatMap((i) => [i, ...(i && 'children' in i && i.children ? i.children : [])])
    .map((i) => String(i?.key))
    .filter((k) => k !== '/' && location.pathname.startsWith(k))
  if (location.pathname === '/') selected.push('/')

  const signOut = async () => {
    await apiFetch('/auth/logout', { method: 'POST' })
    clear()
    await navigate('/signin', { replace: true })
  }

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Layout.Header style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
        <Typography.Text strong style={{ color: 'white', whiteSpace: 'nowrap' }}>
          {t('app.name')}
        </Typography.Text>
        <Menu
          theme="dark"
          mode="horizontal"
          items={items}
          selectedKeys={selected}
          onClick={({ key }) => void navigate(key)}
          style={{ flex: 1, minWidth: 0 }}
        />
        <Space>
          <Typography.Text style={{ color: 'white' }}>{me?.person?.englishName ?? me?.user.username}</Typography.Text>
          <Button onClick={() => void signOut()}>{t('common.signOut')}</Button>
        </Space>
      </Layout.Header>
      <Layout.Content style={{ padding: 24 }}>
        <Outlet />
      </Layout.Content>
    </Layout>
  )
}
