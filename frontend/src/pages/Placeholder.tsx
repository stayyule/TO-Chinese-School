import { Typography } from 'antd'
import { t } from '../i18n'
import type { MessageKey } from '../i18n'

/** Landing page of a route group until its real pages exist. */
export function Placeholder({ title }: { title: MessageKey }) {
  return (
    <>
      <Typography.Title level={3}>{t(title)}</Typography.Title>
      <Typography.Paragraph>{t('placeholder.comingSoon')}</Typography.Paragraph>
    </>
  )
}
