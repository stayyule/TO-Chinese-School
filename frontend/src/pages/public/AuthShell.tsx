import { Alert, Card, Typography } from 'antd'
import type { ReactNode } from 'react'
import { t } from '../../i18n'

/** Page chrome shared by the public pages. */
export function AuthShell({ title, children, wide = false }: { title: string; children: ReactNode; wide?: boolean }) {
  return (
    <main style={{ maxWidth: wide ? 720 : 440, margin: '6vh auto', padding: 16 }}>
      <Typography.Title level={2}>{t('app.name')}</Typography.Title>
      <Card title={title}>{children}</Card>
    </main>
  )
}

export function ErrorAlert({ message }: { message: string | null }) {
  return message ? <Alert type="error" showIcon title={message} role="alert" style={{ marginBottom: 16 }} /> : null
}
