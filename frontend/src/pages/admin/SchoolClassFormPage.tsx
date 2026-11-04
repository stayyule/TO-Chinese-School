import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Form, Input, InputNumber, Select, Typography } from 'antd'
import { useNavigate } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { PATHS } from '../../routes/paths'
import { NotFound } from '../NotFound'
import { QueryBoundary } from '../QueryBoundary'
import { FormActions, FormError } from '../parent/fields'
import { useIdParam } from '../parent/helpers'
import { requiredRule } from '../public/shared'
import { useFormSubmit } from '../useFormSubmit'
import { CLASSES_KEY, SCHOOL_CLASS_TYPES, useGrades, type SchoolClass } from './classes'

interface ClassValues {
  englishName: string
  chineseName: string
  shortName?: string | null
  description?: string | null
  location?: string | null
  schoolClassType: string
  maxSize: number
  minAge?: number | null
  maxAge?: number | null
  gradeId?: number | null
}

const DEFAULT_MAX_SIZE = 25
const textOrNull = (s: string | null | undefined) => (s ?? '').trim() || null

function initialValues(c: SchoolClass | null): Partial<ClassValues> {
  if (!c) return { maxSize: DEFAULT_MAX_SIZE }
  return {
    englishName: c.englishName ?? '',
    chineseName: c.chineseName ?? '',
    shortName: c.shortName ?? '',
    description: c.description ?? '',
    location: c.location ?? '',
    schoolClassType: c.schoolClassType ?? undefined,
    maxSize: c.maxSize ?? DEFAULT_MAX_SIZE,
    minAge: c.minAge,
    maxAge: c.maxAge,
    gradeId: c.gradeId,
  }
}

function requestBody(v: ClassValues) {
  return {
    englishName: v.englishName.trim(),
    chineseName: v.chineseName.trim(),
    shortName: textOrNull(v.shortName),
    description: textOrNull(v.description),
    location: textOrNull(v.location),
    schoolClassType: v.schoolClassType,
    maxSize: v.maxSize,
    minAge: v.minAge ?? null,
    maxAge: v.maxAge ?? null,
    gradeId: v.gradeId ?? null,
  }
}

const ageRules = [{ type: 'integer' as const, min: 0, message: t('error.OUT_OF_RANGE') }]

function SchoolClassForm({ cls }: { cls: SchoolClass | null }) {
  const [form] = Form.useForm<ClassValues>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { can } = useMe()
  const grades = useGrades(can('grades.read'))
  const { busy, error, notFound, submit } = useFormSubmit(
    form,
    (v) => apiJson(cls ? `/school-classes/${cls.id}` : '/school-classes', { method: cls ? 'PATCH' : 'POST', body: JSON.stringify(requestBody(v)) }),
    {
      targets: { NAME_TAKEN: { field: ['englishName'], key: 'classes.nameTaken' } },
      onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: CLASSES_KEY })
        await navigate(PATHS.adminSchoolClasses, { state: { saved: true } })
      },
    },
  )
  if (notFound) return <NotFound />
  return (
    <>
      <Typography.Title level={3}>{cls ? t('classes.editTitle') : t('classes.newTitle')}</Typography.Title>
      <FormError message={error} />
      <Form form={form} layout="vertical" initialValues={initialValues(cls)} onFinish={(v) => void submit(v)} disabled={busy} style={{ maxWidth: 520 }}>
        <Form.Item name="englishName" label={t('classes.englishName')} rules={[requiredRule]}>
          <Input />
        </Form.Item>
        <Form.Item name="chineseName" label={t('classes.chineseName')} rules={[requiredRule]}>
          <Input lang="zh" />
        </Form.Item>
        <Form.Item name="shortName" label={t('classes.shortName')}>
          <Input />
        </Form.Item>
        <Form.Item name="description" label={t('classes.description')}>
          <Input />
        </Form.Item>
        <Form.Item name="location" label={t('classes.location')}>
          <Input />
        </Form.Item>
        <Form.Item name="schoolClassType" label={t('classes.type')} rules={[{ required: true, message: t('error.required') }]}>
          <Select options={SCHOOL_CLASS_TYPES.map((v) => ({ value: v, label: v }))} />
        </Form.Item>
        <Form.Item name="maxSize" label={t('classes.maxSize')} rules={[{ required: true, message: t('error.required') }, { type: 'integer', min: 1, message: t('error.OUT_OF_RANGE') }]}>
          <InputNumber precision={0} controls={false} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="minAge" label={t('classes.minAge')} rules={ageRules}>
          <InputNumber precision={0} controls={false} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item name="maxAge" label={t('classes.maxAge')} rules={ageRules}>
          <InputNumber precision={0} controls={false} style={{ width: '100%' }} />
        </Form.Item>
        {can('grades.read') && (
          <Form.Item name="gradeId" label={t('classes.grade')}>
            <Select
              allowClear
              loading={grades.isPending}
              options={(grades.data ?? []).map((g) => ({ value: g.id, label: g.englishName ?? g.shortName ?? String(g.id) }))}
            />
          </Form.Item>
        )}
        <FormActions busy={busy} cancelTo={PATHS.adminSchoolClasses} />
      </Form>
    </>
  )
}

/** There is no single-class endpoint, so the class comes from the list (gcTime 0: never start the form from stale data). */
function EditLoader({ classId }: { classId: number }) {
  const query = useQuery({ queryKey: [...CLASSES_KEY, 'edit'], queryFn: () => apiJson<SchoolClass[]>('/school-classes'), gcTime: 0 })
  return (
    <QueryBoundary query={query}>
      {(all) => {
        const cls = all.find((c) => c.id === classId)
        return cls ? <SchoolClassForm cls={cls} /> : <NotFound />
      }}
    </QueryBoundary>
  )
}

export function SchoolClassNewPage() {
  return <SchoolClassForm cls={null} />
}

export function SchoolClassEditPage() {
  const classId = useIdParam('classId')
  if (classId === null) return <NotFound />
  return <EditLoader classId={classId} />
}
