import { Button, Result } from 'antd'
import { Link } from 'react-router-dom'
import { t } from '../i18n'

export function NotFound() {
  return (
    <Result
      status="404"
      title={t('notFound.title')}
      subTitle={t('notFound.body')}
      extra={
        <Link to="/">
          <Button type="primary">{t('nav.home')}</Button>
        </Link>
      }
    />
  )
}
