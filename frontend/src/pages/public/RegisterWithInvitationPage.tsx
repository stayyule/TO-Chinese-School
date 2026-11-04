import { Alert, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ApiError, apiJson } from '../../api/client'
import { t } from '../../i18n'
import { PASSWORD_TARGETS, passwordRules, placeError, requiredRule, type FieldTarget } from './shared'
import { ErrorAlert } from './AuthShell'
import { TokenGate } from './TokenGate'

interface Values {
  username: string
  password: string
  passwordConfirmation: string
  phoneNumber: string
}

const TARGETS: Record<string, FieldTarget> = {
  ...PASSWORD_TARGETS,
  USERNAME_TAKEN: { field: ['username'], key: 'invitation.usernameTaken' },
}

export function RegisterWithInvitationPage() {
  const { token = '' } = useParams()
  return (
    <TokenGate<{ personName: string | null }>
      checkPath={`/auth/invitations/${encodeURIComponent(token)}`}
      queryKey="invitation"
      title="invitation.title"
      invalid="invitation.invalidLink"
    >
      {(info) => <InvitationForm token={token} personName={info.personName} />}
    </TokenGate>
  )
}

function InvitationForm({ token, personName }: { token: string; personName: string | null }) {
  const [form] = Form.useForm<Values>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState(false)

  const onFinish = async (values: Values) => {
    setBusy(true)
    setError(null)
    try {
      await apiJson('/auth/register-with-invitation', {
        method: 'POST',
        body: JSON.stringify({ token, ...values, username: values.username.trim(), phoneNumber: values.phoneNumber.trim() }),
      })
      form.resetFields()
      setDone(true)
    } catch (e) {
      setError(e instanceof ApiError && e.code === 'ACCOUNT_EXISTS' ? t('invitation.accountExists') : placeError(form, e, TARGETS))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <>
        <Alert type="success" showIcon title={t('invitation.done')} role="status" style={{ marginBottom: 16 }} />
        <Link to="/signin">{t('common.signIn')}</Link>
      </>
    )
  }

  return (
    <>
      {personName && (
        <Typography.Paragraph>
          {t('invitation.welcome')}, {personName}
        </Typography.Paragraph>
      )}
      <ErrorAlert message={error} />
      <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} disabled={busy}>
        <Form.Item name="username" label={t('field.username')} rules={[requiredRule]}>
          <Input autoComplete="username" />
        </Form.Item>
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
