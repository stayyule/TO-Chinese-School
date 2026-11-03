import { Typography } from 'antd'
import { Link } from 'react-router-dom'
import { t } from '../i18n'

/** Stand-in for the public pages implemented in later tasks (register, password recovery, invitation). */
export function PublicPlaceholder({ name }: { name: string }) {
  return (
    <main style={{ maxWidth: 480, margin: '10vh auto', padding: 16 }}>
      <Typography.Title level={2}>{t('app.name')}</Typography.Title>
      <Typography.Paragraph>{name}</Typography.Paragraph>
      <Link to="/signin">{t('common.signIn')}</Link>
    </main>
  )
}
