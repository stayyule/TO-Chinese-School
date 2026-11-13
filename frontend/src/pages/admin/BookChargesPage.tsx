import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Form, Input, Table, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { centsToDollars, formatCents, parseMoneyInput } from '../../lib/money'
import { PATHS } from '../../routes/paths'
import { NotFound } from '../NotFound'
import { QueryBoundary } from '../QueryBoundary'
import { FormError } from '../parent/fields'
import { useIdParam } from '../parent/helpers'
import { fill } from '../public/shared'
import { useFormSubmit } from '../useFormSubmit'
import { remapItemErrors } from './bookChargeErrors'
import { moneyRules } from './moneyRules'

interface BookCharge {
  id: number
  gradeId: number
  gradeName: string
  bookChargeInCents: number
}

type Values = { charges: Record<string, string> }
type Notice = { text: string; saved: boolean }

const chargesKey = (yearId: number) => ['school-years', yearId, 'book-charges'] as const

function ChargesForm({ yearId, charges }: { yearId: number; charges: BookCharge[] }) {
  const [form] = Form.useForm<Values>()
  const queryClient = useQueryClient()
  const [notice, setNotice] = useState<Notice | null>(null)

  // The body is a bare array of the changed rows only; the call is all-or-nothing on the server.
  const changed = (v: Values) =>
    charges.flatMap((c) => {
      const cents = parseMoneyInput(v.charges[String(c.id)] ?? '')
      return cents !== null && cents !== c.bookChargeInCents ? [{ id: c.id, bookChargeInCents: cents }] : []
    })

  const { busy, error, notFound, submit } = useFormSubmit(
    form,
    async (v) => {
      const body = changed(v)
      if (body.length === 0) {
        setNotice({ text: t('charges.noChanges'), saved: false })
        return
      }
      try {
        await apiJson(`/school-years/${yearId}/book-charges`, { method: 'PUT', body: JSON.stringify(body) })
      } catch (e) {
        throw e instanceof ApiError ? remapItemErrors(e, body.map((b) => b.id)) : e
      }
      await queryClient.invalidateQueries({ queryKey: chargesKey(yearId) })
      setNotice({ text: t('charges.saved'), saved: true })
    },
    { messages: { INVALID_BOOK_CHARGE: 'charges.invalid' } },
  )
  if (notFound) return <NotFound />

  return (
    <Form
      form={form}
      layout="vertical"
      initialValues={{ charges: Object.fromEntries(charges.map((c) => [String(c.id), centsToDollars(c.bookChargeInCents)])) }}
      onFinish={(v) => {
        setNotice(null)
        void submit(v)
      }}
      disabled={busy}
    >
      <FormError message={error} />
      {notice && <Alert type={notice.saved ? 'success' : 'info'} showIcon title={notice.text} role="status" style={{ marginBottom: 16 }} />}
      <Table
        rowKey="id"
        dataSource={charges}
        pagination={false}
        columns={[
          { title: t('charges.grade'), dataIndex: 'gradeName' },
          {
            title: t('charges.amount'),
            key: 'amount',
            render: (_, c) => (
              <Form.Item name={['charges', String(c.id)]} rules={moneyRules} style={{ margin: 0 }}>
                <Input aria-label={fill('charges.inputLabel', { grade: c.gradeName })} inputMode="decimal" autoComplete="off" style={{ width: 140 }} />
              </Form.Item>
            ),
          },
        ]}
      />
      <Button type="primary" htmlType="submit" loading={busy} style={{ marginTop: 16 }}>
        {t('common.save')}
      </Button>
    </Form>
  )
}

function ChargesReadOnly({ charges }: { charges: BookCharge[] }) {
  return (
    <Table
      rowKey="id"
      dataSource={charges}
      pagination={false}
      columns={[
        { title: t('charges.grade'), dataIndex: 'gradeName' },
        { title: t('charges.amount'), dataIndex: 'bookChargeInCents', render: (c: number) => formatCents(c) },
      ]}
    />
  )
}

function ChargesLoader({ yearId }: { yearId: number }) {
  const { can } = useMe()
  // gcTime 0: the form takes its initial values once, so it must not start from cached (stale) amounts.
  const query = useQuery({ queryKey: chargesKey(yearId), queryFn: () => apiJson<BookCharge[]>(`/school-years/${yearId}/book-charges`), gcTime: 0 })
  return (
    <QueryBoundary query={query}>
      {(charges) => (can('school_years.book_charges.edit') ? <ChargesForm yearId={yearId} charges={charges} /> : <ChargesReadOnly charges={charges} />)}
    </QueryBoundary>
  )
}

export function BookChargesPage() {
  const yearId = useIdParam('yearId')
  if (yearId === null) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{t('charges.title')}</Typography.Title>
      <Link to={PATHS.adminSchoolYears}>{t('year.listTitle')}</Link>
      <div style={{ marginTop: 16, maxWidth: 560 }}>
        <ChargesLoader yearId={yearId} />
      </div>
    </>
  )
}
