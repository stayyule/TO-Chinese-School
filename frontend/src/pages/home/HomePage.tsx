import { Card, Space, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { PANELS } from './panels'

/** One card per role panel the user holds (the API decides what each link may do). */
export function HomePage() {
  const { can } = useMe()
  const visible = PANELS.filter((p) => can(p.permission))
  return (
    <Space orientation="vertical" size="middle" style={{ display: 'flex' }}>
      {visible.map((panel) => {
        const links = panel.links.filter((l) => !l.permission || can(l.permission))
        return (
        <Card key={panel.permission} title={<Typography.Title level={4} style={{ margin: 0 }}>{panel.title}</Typography.Title>}>
          {links.length === 0 ? (
            <Typography.Text type="secondary">{t('home.noLinks')}</Typography.Text>
          ) : (
            <Space wrap>
              {links.map((l) => (
                <Link key={l.to + l.label} to={l.to}>
                  {l.label}
                </Link>
              ))}
            </Space>
          )}
        </Card>
        )
      })}
    </Space>
  )
}
