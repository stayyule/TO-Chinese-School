import { Form, Typography } from 'antd'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { FamilyLookup } from './FamilyLookup'
import type { FamilyView } from './families'
import { AddressFields, FormActions, FormError } from './fields'
import { addressBody, addressInitial, useSubmit, type AddressValues } from './helpers'

function AddressForm({ family }: { family: FamilyView }) {
  const [form] = Form.useForm<AddressValues>()
  const { busy, error, notFound, submit } = useSubmit(form, (v) =>
    apiJson(`/me/families/${family.id}/address`, { method: 'PATCH', body: JSON.stringify(addressBody(v)) }),
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{t('family.addressTitle')}</Typography.Title>
      <FormError message={error} />
      <Form form={form} layout="vertical" initialValues={addressInitial(family.address)} onFinish={(v) => void submit(v)} disabled={busy} style={{ maxWidth: 520 }}>
        <AddressFields />
        <FormActions busy={busy} />
      </Form>
    </>
  )
}

export function EditAddressPage() {
  return <FamilyLookup>{(family) => <AddressForm family={family} />}</FamilyLookup>
}
