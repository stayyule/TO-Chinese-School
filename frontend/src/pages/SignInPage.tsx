// PLACEHOLDER: minimal sign-in form so the auth flow is testable. Task 21 replaces this page with the real one.
import { Alert, Button, Card, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ApiError, apiJson, safeReturnTo } from '../api/client'
import { useAuthActions } from '../auth/useMe'
import { t } from '../i18n'

export function SignInPage() {
  const [params] = useSearchParams()
  const navigate = useNavigate()
  const { clear } = useAuthActions()
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFinish = async (values: { username: string; password: string }) => {
    setBusy(true)
    setError(null)
    try {
      await apiJson('/auth/login', { method: 'POST', body: JSON.stringify(values) })
      clear()
      await navigate(safeReturnTo(params.get('returnTo')), { replace: true })
    } catch (e) {
      setError(e instanceof ApiError ? e.message : t('signin.failed'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <main style={{ maxWidth: 400, margin: '10vh auto', padding: 16 }}>
      <Typography.Title level={2}>{t('app.name')}</Typography.Title>
      <Card>
        {error && <Alert type="error" title={error} style={{ marginBottom: 16 }} />}
        <Form layout="vertical" onFinish={(v) => void onFinish(v as { username: string; password: string })}>
          <Form.Item name="username" label={t('signin.username')} rules={[{ required: true }]}>
            <Input autoComplete="username" />
          </Form.Item>
          <Form.Item name="password" label={t('signin.password')} rules={[{ required: true }]}>
            <Input.Password autoComplete="current-password" />
          </Form.Item>
          <Button type="primary" htmlType="submit" loading={busy}>
            {t('common.signIn')}
          </Button>
        </Form>
      </Card>
    </main>
  )
}
