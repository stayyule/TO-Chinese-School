import { Form, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { PATHS, staffFamilyPath } from '../../routes/paths'
import { NotFound } from '../NotFound'
import { AddressFields, FormActions, FormError, PersonFields } from '../parent/fields'
import { addressBody, personBody, type AddressValues, type PersonValues } from '../parent/helpers'
import { useFormSubmit } from '../useFormSubmit'

interface NewFamilyValues {
  address: AddressValues
  parentOne: PersonValues
}

/** Registers a new family: its address and parent one (the account is created later through an invitation). */
export function NewFamilyPage() {
  const [form] = Form.useForm<NewFamilyValues>()
  const navigate = useNavigate()
  const { busy, error, notFound, submit } = useFormSubmit(
    form,
    async (v) => {
      const created = await apiJson<{ id: number }>('/families', {
        method: 'POST',
        body: JSON.stringify({ address: addressBody(v.address), parentOne: personBody(v.parentOne) }),
      })
      await navigate(staffFamilyPath(created.id))
    },
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{t('staff.family.new')}</Typography.Title>
      <FormError message={error} />
      <Form form={form} layout="vertical" onFinish={(v) => void submit(v)} disabled={busy} style={{ maxWidth: 520 }}>
        <Typography.Title level={4}>{t('register.address')}</Typography.Title>
        <AddressFields prefix={['address']} />
        <Typography.Title level={4}>{t('register.parent')}</Typography.Title>
        <PersonFields showBirth={false} prefix={['parentOne']} />
        <FormActions busy={busy} cancelTo={PATHS.registrationPeople} saveLabel={t('staff.family.create')} />
      </Form>
    </>
  )
}
