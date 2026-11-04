import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Form, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { centsToDollars } from '../../lib/money'
import { PATHS } from '../../routes/paths'
import { NotFound } from '../NotFound'
import { QueryBoundary } from '../QueryBoundary'
import { FormActions, FormError } from '../parent/fields'
import { useIdParam } from '../parent/helpers'
import { useFormSubmit } from '../useFormSubmit'
import { parseMoneyInput } from '../../lib/money'
import { YearFields } from './YearFields'
import { DATE_FIELDS, MONEY_FIELDS, SCHOOL_YEARS_KEY, isFrozenDate, pacificTodayIso, type DateField, type MoneyField, type SchoolYear } from './years'

type YearValues = { name: string; description?: string; ageCutoffMonth: number | null } & Record<DateField | MoneyField, string>

function initialValues(year: SchoolYear | null): Partial<YearValues> {
  if (!year) return {}
  const v: Record<string, unknown> = { name: year.name ?? '', description: year.description ?? '', ageCutoffMonth: year.ageCutoffMonth }
  for (const [f] of DATE_FIELDS) v[f] = year[f] ?? ''
  for (const [f] of MONEY_FIELDS) v[f] = centsToDollars(year[f])
  return v as Partial<YearValues>
}

/** Request body: money as integer cents; dates that have passed are left out (the API keeps them as stored). */
function requestBody(v: YearValues, frozen: ReadonlySet<DateField>): Record<string, unknown> {
  const body: Record<string, unknown> = { name: v.name.trim(), description: (v.description ?? '').trim(), ageCutoffMonth: v.ageCutoffMonth }
  for (const [f] of DATE_FIELDS) if (!frozen.has(f)) body[f] = (v[f] ?? '').trim()
  for (const [f] of MONEY_FIELDS) body[f] = parseMoneyInput(v[f] ?? '')
  return body
}

function SchoolYearForm({ year }: { year: SchoolYear | null }) {
  const [form] = Form.useForm<YearValues>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const today = pacificTodayIso()
  const frozen = new Set<DateField>(year ? DATE_FIELDS.map(([f]) => f).filter((f) => isFrozenDate(year[f], today)) : [])
  const { busy, error, notFound, submit } = useFormSubmit(
    form,
    (v) => apiJson(year ? `/school-years/${year.id}` : '/school-years', { method: year ? 'PATCH' : 'POST', body: JSON.stringify(requestBody(v, frozen)) }),
    {
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: SCHOOL_YEARS_KEY })
        await navigate(PATHS.adminSchoolYears, { state: { saved: true } })
      },
    },
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{year ? t('year.editTitle') : t('year.newTitle')}</Typography.Title>
      <FormError message={error} />
      <Form form={form} layout="vertical" initialValues={initialValues(year)} onFinish={(v) => void submit(v)} disabled={busy} style={{ maxWidth: 560 }}>
        <YearFields frozen={frozen} />
        <FormActions busy={busy} cancelTo={PATHS.adminSchoolYears} />
      </Form>
    </>
  )
}

/** gcTime 0: the form takes its initial values once, so it must never start from a cached (stale) year. */
function EditLoader({ yearId }: { yearId: number }) {
  const query = useQuery({ queryKey: [...SCHOOL_YEARS_KEY, yearId], queryFn: () => apiJson<SchoolYear>(`/school-years/${yearId}`), gcTime: 0 })
  return <QueryBoundary query={query}>{(year) => <SchoolYearForm year={year} />}</QueryBoundary>
}

export function SchoolYearNewPage() {
  return <SchoolYearForm year={null} />
}

export function SchoolYearEditPage() {
  const yearId = useIdParam('yearId')
  if (yearId === null) return <NotFound />
  return <EditLoader yearId={yearId} />
}
