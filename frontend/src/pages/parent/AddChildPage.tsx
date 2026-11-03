import { Form, Typography } from 'antd'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { FamilyLookup } from './FamilyLookup'
import type { FamilyView } from './families'
import { FormActions, FormError, PersonFields } from './fields'
import { personBody, useSubmit, type PersonValues } from './helpers'

function ChildForm({ family }: { family: FamilyView }) {
  const [form] = Form.useForm<PersonValues>()
  const { busy, error, notFound, submit } = useSubmit(form, (v) =>
    apiJson(`/me/families/${family.id}/children`, { method: 'POST', body: JSON.stringify(personBody(v)) }),
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{t('family.addChildTitle')}</Typography.Title>
      <FormError message={error} />
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)} disabled={busy} style={{ maxWidth: 520 }}>
        <PersonFields showBirth />
        <FormActions busy={busy} />
      </Form>
    </>
  )
}

export function AddChildPage() {
  return <FamilyLookup>{(family) => <ChildForm family={family} />}</FamilyLookup>
}
