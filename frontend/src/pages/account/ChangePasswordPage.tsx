import { Alert, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { apiFetch } from '../../api/client'
import { t } from '../../i18n'
import { fill, lockMinutes, placeError, readError, type FieldTarget } from '../public/shared'
import { ErrorAlert } from '../public/AuthShell'

interface Values {
  currentPassword: string
  newPassword: string
  newPasswordConfirmation: string
}

const TARGETS: Record<string, FieldTarget> = {
  CURRENT_PASSWORD_INVALID: { field: ['currentPassword'], key: 'error.currentPasswordInvalid' },
  PASSWORD_MISMATCH: { field: ['newPasswordConfirmation'], key: 'error.passwordMismatch' },
  PASSWORD_TOO_SHORT: { field: ['newPassword'], key: 'error.passwordTooShort' },
}

export function ChangePasswordPage() {
  const [form] = Form.useForm<Values>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onFinish = async (values: Values) => {
    setBusy(true)
    setError(null)
    setDone(false)
    try {
      const res = await apiFetch('/me/password', { method: 'POST', body: JSON.stringify(values) })
      if (res.ok) {
        form.resetFields()
        setDone(true)
        return
      }
      const { error: err, retryAfter } = await readError(res)
      setError(
        err.status === 429
          ? fill('account.password.locked', { minutes: lockMinutes(err, retryAfter) })
          : placeError(form, err, TARGETS),
      )
    } catch (e) {
      setError(placeError(form, e, TARGETS))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{ maxWidth: 440 }}>
      <Typography.Title level={3}>{t('account.password.title')}</Typography.Title>
      {done && <Alert type="success" showIcon title={t('account.password.done')} role="status" style={{ marginBottom: 16 }} />}
      <ErrorAlert message={error} />
      <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} disabled={busy}>
        <Form.Item name="currentPassword" label={t('field.currentPassword')} rules={[{ required: true, message: t('error.required') }]}>
          <Input.Password autoComplete="current-password" />
        </Form.Item>
        <Form.Item
          name="newPassword"
          label={t('field.newPassword')}
          rules={[
            { required: true, message: t('error.required') },
            { min: 10, message: t('error.passwordTooShort') },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item
          name="newPasswordConfirmation"
          label={t('field.newPasswordConfirmation')}
          rules={[{ required: true, message: t('error.required') }]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('common.save')}
        </Button>
      </Form>
    </div>
  )
}
