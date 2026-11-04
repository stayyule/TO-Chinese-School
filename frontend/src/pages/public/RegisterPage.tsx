import { Alert, Button, Form, Input, Select, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiJson } from '../../api/client'
import { t } from '../../i18n'
import { digitCount } from '../parent/helpers'
import { MIN_PASSWORD_LENGTH, PASSWORD_TARGETS, placeError, requiredRule, type FieldTarget } from './shared'
import { AuthShell, ErrorAlert } from './AuthShell'

interface Values {
  address: { street: string; city: string; state: string; zipcode: string; homePhone: string; cellPhone?: string; email: string }
  parentOne: { englishFirstName: string; englishLastName: string; chineseName?: string; gender: 'M' | 'F'; nativeLanguage?: string }
  username: string
  password: string
  passwordConfirmation: string
}

const TARGETS: Record<string, FieldTarget> = {
  PASSWORD_MISMATCH: PASSWORD_TARGETS.PASSWORD_MISMATCH as FieldTarget,
  PASSWORD_TOO_SHORT: PASSWORD_TARGETS.PASSWORD_TOO_SHORT as FieldTarget,
  USERNAME_TAKEN: { field: ['username'], key: 'register.usernameTaken' },
}

/** Trimmed copy of an object's string values; blank optional values are dropped. */
function clean<T extends object>(obj: T): T {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(obj)) {
    const value = typeof v === 'string' ? v.trim() : v
    if (value !== '' && value !== undefined && value !== null) out[k] = value
  }
  return out as T
}

export function RegisterPage() {
  const [form] = Form.useForm<Values>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [emailTaken, setEmailTaken] = useState(false)
  const [done, setDone] = useState(false)

  const onFinish = async (values: Values) => {
    setBusy(true)
    setError(null)
    setEmailTaken(false)
    try {
      await apiJson('/auth/register', {
        method: 'POST',
        body: JSON.stringify({
          address: clean(values.address),
          parentOne: clean(values.parentOne),
          username: values.username.trim(),
          password: values.password,
          passwordConfirmation: values.passwordConfirmation,
        }),
      })
      form.resetFields()
      setDone(true)
    } catch (e) {
      if (e instanceof ApiError && e.code === 'EMAIL_ALREADY_REGISTERED') setEmailTaken(true)
      else setError(placeError(form, e, TARGETS))
    } finally {
      setBusy(false)
    }
  }

  if (done) {
    return (
      <AuthShell title={t('register.title')} wide>
        <Alert type="success" showIcon title={t('register.done')} role="status" style={{ marginBottom: 16 }} />
        <Link to="/signin">{t('common.signIn')}</Link>
      </AuthShell>
    )
  }

  return (
    <AuthShell title={t('register.title')} wide>
      <ErrorAlert message={error} />
      {emailTaken && (
        <Alert
          type="error"
          showIcon
          role="alert"
          style={{ marginBottom: 16 }}
          title={t('register.emailRegistered')}
          description={<Link to="/forgot-username">{t('register.forgotUsernameLink')}</Link>}
        />
      )}
      <Form form={form} layout="vertical" onFinish={(v) => void onFinish(v)} disabled={busy}>
        <Typography.Title level={4}>{t('register.parent')}</Typography.Title>
        <Form.Item name={['parentOne', 'englishFirstName']} label={t('register.englishFirstName')} rules={[requiredRule]}>
          <Input autoComplete="given-name" />
        </Form.Item>
        <Form.Item name={['parentOne', 'englishLastName']} label={t('register.englishLastName')} rules={[requiredRule]}>
          <Input autoComplete="family-name" />
        </Form.Item>
        <Form.Item name={['parentOne', 'chineseName']} label={t('register.chineseName')}>
          <Input lang="zh" />
        </Form.Item>
        <Form.Item name={['parentOne', 'gender']} label={t('register.gender')} rules={[{ required: true, message: t('error.required') }]}>
          <Select
            options={[
              { value: 'M', label: t('register.male') },
              { value: 'F', label: t('register.female') },
            ]}
          />
        </Form.Item>
        <Form.Item name={['parentOne', 'nativeLanguage']} label={t('register.nativeLanguage')}>
          <Input />
        </Form.Item>

        <Typography.Title level={4}>{t('register.address')}</Typography.Title>
        <Form.Item name={['address', 'street']} label={t('register.street')} rules={[requiredRule]}>
          <Input autoComplete="address-line1" />
        </Form.Item>
        <Form.Item name={['address', 'city']} label={t('register.city')} rules={[requiredRule]}>
          <Input autoComplete="address-level2" />
        </Form.Item>
        <Form.Item name={['address', 'state']} label={t('register.state')} rules={[requiredRule]}>
          <Input autoComplete="address-level1" />
        </Form.Item>
        <Form.Item
          name={['address', 'zipcode']}
          label={t('register.zipcode')}
          rules={[requiredRule, { pattern: /^\d{1,5}$/, message: t('register.zipcodeFormat') }]}
        >
          <Input autoComplete="postal-code" inputMode="numeric" maxLength={5} />
        </Form.Item>
        <Form.Item
          name={['address', 'homePhone']}
          label={t('register.homePhone')}
          extra={t('register.homePhoneHelp')}
          rules={[
            requiredRule,
            { validator: (_, v: string | undefined) => (!v || digitCount(v) === 10 ? Promise.resolve() : Promise.reject(new Error(t('register.homePhoneFormat')))) },
          ]}
        >
          <Input autoComplete="tel" inputMode="tel" />
        </Form.Item>
        <Form.Item name={['address', 'cellPhone']} label={t('register.cellPhone')}>
          <Input autoComplete="tel" inputMode="tel" />
        </Form.Item>
        <Form.Item
          name={['address', 'email']}
          label={t('register.email')}
          rules={[requiredRule, { type: 'email', message: t('error.INVALID') }]}
        >
          <Input autoComplete="email" inputMode="email" />
        </Form.Item>

        <Typography.Title level={4}>{t('register.account')}</Typography.Title>
        <Form.Item name="username" label={t('field.username')} rules={[requiredRule]}>
          <Input autoComplete="username" />
        </Form.Item>
        <Form.Item
          name="password"
          label={t('field.password')}
          rules={[
            { required: true, message: t('error.required') },
            { min: MIN_PASSWORD_LENGTH, message: t('error.passwordTooShort') },
          ]}
        >
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Form.Item name="passwordConfirmation" label={t('field.passwordConfirmation')} rules={[{ required: true, message: t('error.required') }]}>
          <Input.Password autoComplete="new-password" />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('common.submit')}
        </Button>
      </Form>
      <p>
        <Link to="/signin">{t('common.backToSignIn')}</Link>
      </p>
    </AuthShell>
  )
}
