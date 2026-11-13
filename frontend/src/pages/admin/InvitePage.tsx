import { Alert, Button, Form, Input, Typography } from 'antd'
import { useState } from 'react'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { FormError } from '../parent/fields'
import { requiredRule } from '../public/shared'
import { useFormSubmit } from '../useFormSubmit'

interface InviteValues {
  personId: string
  emailDestination: string
}

/** Super User: mails a registration invitation for an existing person to the given email address. */
export function InvitePage() {
  const [form] = Form.useForm<InviteValues>()
  const [sent, setSent] = useState(false)
  const { busy, error, notFound, submit } = useFormSubmit(
    form,
    (v) =>
      apiJson('/admin/user-registration/invitations', {
        method: 'POST',
        body: JSON.stringify({ personId: Number(v.personId.trim()), emailDestination: v.emailDestination.trim() }),
      }),
    {
      targets: {
        PERSON_NOT_FOUND: { field: ['personId'], key: 'invite.personNotFound' },
        PERSON_ALREADY_HAS_ACCOUNT: { field: ['personId'], key: 'invite.alreadyHasAccount' },
        EMAIL_REQUIRED: { field: ['emailDestination'], key: 'invite.emailRequired' },
      },
      onSuccess: () => {
        setSent(true)
        form.resetFields()
      },
    },
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{t('invite.title')}</Typography.Title>
      <FormError message={error} />
      {sent && <Alert type="success" showIcon title={t('invite.sent')} role="status" style={{ marginBottom: 16 }} />}
      <Form
        form={form}
        layout="vertical"
        onFinish={(v) => {
          setSent(false)
          void submit(v)
        }}
        disabled={busy}
        style={{ maxWidth: 420 }}
      >
        <Form.Item
          name="personId"
          label={t('invite.personId')}
          rules={[requiredRule, { pattern: /^\d{1,9}$/, message: t('invite.wholeNumber') }]}
        >
          <Input inputMode="numeric" autoComplete="off" />
        </Form.Item>
        <Form.Item
          name="emailDestination"
          label={t('field.email')}
          rules={[requiredRule, { type: 'email', message: t('error.INVALID') }]}
        >
          <Input type="email" autoComplete="off" maxLength={254} />
        </Form.Item>
        <Button type="primary" htmlType="submit" loading={busy}>
          {t('invite.send')}
        </Button>
      </Form>
    </>
  )
}
