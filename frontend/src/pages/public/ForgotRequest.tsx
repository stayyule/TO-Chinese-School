import { Alert, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiFetch } from '../../api/client'
import { t, type MessageKey } from '../../i18n'
import { requiredRule } from './shared'
import { AuthShell, ErrorAlert } from './AuthShell'

/**
 * Shared body of the forgot-password and forgot-username pages. The API always answers 202, so a 2xx shows one
 * fixed confirmation that never depends on what was typed; anything else is a generic failure.
 */
export function ForgotRequest({
  path,
  field,
  label,
  title,
  done,
}: {
  path: string
  field: 'username' | 'email'
  label: MessageKey
  title: MessageKey
  done: MessageKey
}) {
  const [state, setState] = useState<'form' | 'done' | 'error'>('form')
  const [busy, setBusy] = useState(false)

  const onFinish = async (values: Record<string, string | undefined>) => {
    setBusy(true)
    setState('form')
    try {
      const res = await apiFetch(path, { method: 'POST', body: JSON.stringify({ [field]: (values[field] ?? '').trim() }) })
      setState(res.ok ? 'done' : 'error')
    } catch {
      setState('error')
    } finally {
      setBusy(false)
    }
  }

  return (
    <AuthShell title={t(title)}>
      {state === 'done' ? (
        <Alert type="success" showIcon title={t(done)} role="status" style={{ marginBottom: 16 }} />
      ) : (
        <>
          <ErrorAlert message={state === 'error' ? t('common.genericError') : null} />
          <Form layout="vertical" onFinish={(v) => void onFinish(v as Record<string, string | undefined>)} disabled={busy}>
            <Form.Item name={field} label={t(label)} rules={[requiredRule]}>
              <Input autoComplete={field === 'email' ? 'email' : 'username'} />
            </Form.Item>
            <Button type="primary" htmlType="submit" loading={busy}>
              {t('common.submit')}
            </Button>
          </Form>
        </>
      )}
      <p>
        <Link to="/signin">{t('common.backToSignIn')}</Link>
      </p>
    </AuthShell>
  )
}
