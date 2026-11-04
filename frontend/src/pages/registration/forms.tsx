
import { Card, Form } from 'antd'
import { apiJson } from '../../api/client'
import type { MessageKey } from '../../i18n'
import { NotFound } from '../NotFound'
import type { AddressView, PersonView } from '../parent/families'
import { AddressFields, FormActions, FormError, PersonFields } from '../parent/fields'
import { addressBody, addressInitial, personInitial, type AddressValues, type PersonValues } from '../parent/helpers'
import { useFormSubmit } from '../useFormSubmit'
import { useRefreshStaff } from './staff'


interface PersonFormProps {
  title: string
  showBirth: boolean
  initial?: PersonView | null
  /** Sends the (validated) values to the API. */
  run: (values: PersonValues) => Promise<unknown>
  onDone: () => void
  onCancel: () => void
  messages?: Record<string, MessageKey>
}

/** Inline person form (edit a person, add a parent or a child). Closes itself through onDone after a successful save. */
export function PersonFormCard({ title, showBirth, initial = null, run, onDone, onCancel, messages }: PersonFormProps) {
  const [form] = Form.useForm<PersonValues>()
  const refresh = useRefreshStaff()
  const { busy, error, notFound, submit } = useFormSubmit(form, run, {
    messages,
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })
  if (notFound) return <NotFound />
  return (
    <Card title={title} style={{ marginBottom: 16, maxWidth: 560 }}>
      <FormError message={error} />
      <Form form={form} layout="vertical" initialValues={personInitial(initial)} onFinish={(v) => void submit(v)} disabled={busy}>
        <PersonFields showBirth={showBirth} />
        <FormActions busy={busy} cancelTo={onCancel} />
      </Form>
    </Card>
  )
}

interface AddressFormProps {
  title: string
  initial: AddressView | null
  /** POST for a new personal address, PATCH to change an existing one. */
  method: 'POST' | 'PATCH'
  path: string
  onDone: () => void
  onCancel: () => void
}

export function AddressFormCard({ title, initial, method, path, onDone, onCancel }: AddressFormProps) {
  const [form] = Form.useForm<AddressValues>()
  const refresh = useRefreshStaff()
  const { busy, error, notFound, submit } = useFormSubmit(form, (v) => apiJson(path, { method, body: JSON.stringify(addressBody(v)) }), {
    onSuccess: async () => {
      await refresh()
      onDone()
    },
  })
  if (notFound) return <NotFound />
  return (
    <Card title={title} style={{ marginBottom: 16, maxWidth: 560 }}>
      <FormError message={error} />
      <Form form={form} layout="vertical" initialValues={addressInitial(initial)} onFinish={(v) => void submit(v)} disabled={busy}>
        <AddressFields />
        <FormActions busy={busy} cancelTo={onCancel} />
      </Form>
    </Card>
  )
}
