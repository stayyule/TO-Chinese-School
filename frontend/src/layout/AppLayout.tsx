import { Button, Layout, Menu, Space, Typography } from 'antd'
import { Outlet, useLocation, useNavigate } from 'react-router-dom'
import { apiFetch } from '../api/client'
import { useAuthActions, useMe } from '../auth/useMe'
import { t } from '../i18n'
import { menuItems } from './menu'

/** Page chrome: header with the permission-gated menu (see menuItems) and the routed page. */
export function AppLayout() {
  const { me, can } = useMe()
  const { clear } = useAuthActions()
  const location = useLocation()
  const navigate = useNavigate()
  const items = menuItems(can)

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
