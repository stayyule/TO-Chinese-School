import { Button, Form, Result, Spin, Typography } from 'antd'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { useFamilies, type PersonView } from './families'
import { FormActions, FormError, PersonFields } from './fields'
import { personBody, personInitial, useIdParam, useSubmit, type PersonValues } from './helpers'

function PersonForm({ person, isChild }: { person: PersonView; isChild: boolean }) {
  const [form] = Form.useForm<PersonValues>()
  const { busy, error, notFound, submit } = useSubmit(form, (v) =>
    apiJson(`/me/people/${person.id}`, {
      method: 'PATCH',
      // Parents' stored birth values (not editable here) are sent back unchanged.
      body: JSON.stringify(personBody(isChild ? v : { ...v, birthYear: person.birthYear, birthMonth: person.birthMonth })),
    }),
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{t('family.editPersonTitle')}</Typography.Title>
      <FormError message={error} />
      <Form form={form} layout="vertical" initialValues={personInitial(person)} onFinish={(v) => void submit(v)} disabled={busy} style={{ maxWidth: 520 }}>
        <PersonFields showBirth={isChild} />
        <FormActions busy={busy} />
      </Form>
    </>
  )
}

/** Edits the user's own record, the other parent, or a child, looked up among the user's own families. */
export function EditPersonPage() {
  const personId = useIdParam('personId')
  const { data, isPending, isError, refetch } = useFamilies()
  if (personId === null) return <NotFound />
  if (isPending) return <Spin />
  if (isError) {
    return <Result status="error" title={t('family.loadFailed')} extra={<Button onClick={() => void refetch()}>{t('family.retry')}</Button>} />
  }
  for (const f of data) {
    const child = f.children.find((c) => c.id === personId)
    if (child) return <PersonForm person={child} isChild />
    const parent = [f.parentOne, f.parentTwo].find((p) => p?.id === personId)
    if (parent) return <PersonForm person={parent} isChild={false} />
  }
  return <NotFound />
}
