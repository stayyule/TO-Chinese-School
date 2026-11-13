import { Alert, Button, Form, Input } from 'antd'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { PASSWORD_TARGETS, passwordRules, placeError, requiredRule } from './shared'
import { ErrorAlert } from './AuthShell'
import { TokenGate } from './TokenGate'

interface Values {
  password: string
  passwordConfirmation: string
  phoneNumber: string
}

export function ResetPasswordPage() {
  const { token = '' } = useParams()
  return (
    <TokenGate
      checkPath={`/auth/reset-tokens/${encodeURIComponent(token)}`}
      queryKey="reset-token"
      title="reset.title"
      invalid="reset.invalidLink"
      recoveryLink={{ to: '/forgot-password', label: 'reset.requestNew' }}
    >
      {() => <ResetForm token={token} />}
    </TokenGate>
  )
}

function ResetForm({ token }: { token: string }) {
  const [form] = Form.useForm<Values>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onFinish = async (values: Values) => {
    setBusy(true)
    setError(null)
    try {
      await apiJson('/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify({ token, ...values, phoneNumber: values.phoneNumber.trim() }),
      })
      form.resetFields()
      setDone(true)
    } catch (e) {
      setError(placeError(form, e, PASSWORD_TARGETS))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <>
        <Alert type="success" showIcon title={t('reset.done')} role="status" style={{ marginBottom: 16 }} />
        <Link to="/signin">{t('common.signIn')}</Link>
      </>
    )
  }

  return (
    <>
      <ErrorAlert message={error} />
      <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} disabled={busy}>
        <Form.Item name="password" label={t('field.password')} rules={passwordRules}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="passwordConfirmation" label={t('field.passwordConfirmation')} rules={[{ required: true, message: t('error.required') }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="phoneNumber" label={t('field.phoneNumber')} extra={t('reset.phoneHelp')} rules={[requiredRule]}>
          <Input autoComplete="tel" inputMode="tel" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('common.submit')}
        </Button>
      </Form>
    </>
  )
}
