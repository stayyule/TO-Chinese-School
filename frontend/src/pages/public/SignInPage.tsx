import { Button, Card, Form, Input, Space, Typography } from 'antd'
import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { apiFetch, safeReturnTo } from '../../api/client'
import { useAuthActions } from '../../auth/useMe'
import { t } from '../../i18n'
import { applyDetails, fill, lockMinutes, readError, requiredRule } from './shared'
import { ErrorAlert } from './AuthShell'

interface Values {
  username: string
  password: string
}

export function SignInPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { clear } = useAuthActions()
  const [form] = Form.useForm<Values>()
  const [error, setError] = useState<string | null>(null)
  const [invalid, setInvalid] = useState(false)
  const [busy, setBusy] = useState(false)

  const onFinish = async (values: Values) => {
    setBusy(true)
    setError(null)
    setInvalid(false)
    try {
      const res = await apiFetch('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ username: values.username.trim(), password: values.password }),
      })
      if (res.ok) {
        clear()
        await navigate(safeReturnTo(params.get('returnTo')), { replace: true })
        return
      }
      const { error: err, retryAfter } = await readError(res)
      if (err.status === 401) setInvalid(true)
      else if (err.status === 429) setError(fill('signin.locked', { minutes: lockMinutes(err, retryAfter) }))
      else if (!applyDetails(form, err)) setError(t('signin.failed'))
    } catch {
      setError(t('signin.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 440, margin: '10vh auto', padding: 16 }}>
      <Typography.Title level={2}>{t('app.name')}</Typography.Title>
      <Card title={t('signin.title')}>
        <ErrorAlert message={invalid ? t('signin.invalid') : error} />
        {invalid && (
          <Typography.Paragraph>
            {t('signin.supportPrefix')} <a href={`mailto:${t('common.supportEmail')}`}>{t('common.supportEmail')}</a>
          </Typography.Paragraph>
        )}
        <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} disabled={busy}>
          <Form.Item name="username" label={t('signin.username')} rules={[requiredRule]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={t('signin.password')} rules={[{ required: true, message: t('error.required') }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            {t('common.signIn')}
          </Button>
        </Form>
        <Space orientation="vertical" style={{ marginTop: 16 }}>
          <Link to="/forgot-username">{t('signin.forgotUsername')}</Link>
          <Link to="/forgot-password">{t('signin.forgotPassword')}</Link>
          <Link to="/register">{t('signin.register')}</Link>
        </Space>
      </Card>
    </main>
  )
}
