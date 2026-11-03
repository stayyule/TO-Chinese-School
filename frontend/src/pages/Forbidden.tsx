import { Button, Result } from 'antd'
import { Link } from 'react-router-dom'
import { t } from '../i18n'

export function Forbidden() {
  return (
    <Result
      status="403"
      title={t('forbidden.title')}
      subTitle={t('forbidden.body')}
      extra={
        <Link to="/">
          <Button type="primary">{t('nav.home')}</Button>
        </Link>
      }
    />
  )
}
