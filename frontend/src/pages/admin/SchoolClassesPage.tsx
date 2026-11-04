import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Space, Switch, Table, Typography } from 'antd'
import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { PATHS, schoolClassEditPath } from '../../routes/paths'
import { QueryBoundary } from '../QueryBoundary'
import { fill } from '../public/shared'
import { CLASSES_KEY, useSchoolClasses, type SchoolClass } from './classes'
import { currentAndNextYear, pacificTodayIso, useSchoolYears } from './years'

interface YearRef {
  id: number
  name: string | null
}

/** Per-year active switch; one request at a time per class and year. */
function ActiveSwitch({ cls, year, checked }: { cls: SchoolClass; year: YearRef; checked: boolean }) {
  const queryClient = useQueryClient()
  const inflight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const change = async (active: boolean) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailed(false)
    try {
      await apiJson(`/school-classes/${cls.id}/active`, { method: 'PUT', body: JSON.stringify({ schoolYearId: year.id, active }) })
      await queryClient.invalidateQueries({ queryKey: CLASSES_KEY })
    } catch {
      setFailed(true)
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  return (
    <Space>
      <Switch
        checked={checked}
        loading={busy}
        aria-label={fill('classes.toggleLabel', { class: cls.englishName ?? String(cls.id), year: year.name ?? String(year.id) })}
        onChange={(v) => void change(v)}
      />
      {failed && <Typography.Text type="danger">{t('common.genericError')}</Typography.Text>}
    </Space>
  )
}

const yesNo = (v: boolean) => (v ? t('classes.yes') : t('classes.no'))

export function SchoolClassesPage() {
  const { can } = useMe()
  const canToggle = can('school_classes.toggle_active')
  const location = useLocation()
  const saved = (location.state as { saved?: boolean } | null)?.saved === true
  const classes = useSchoolClasses()
  // The years are needed only to know which year ids the two flags belong to.
  const years = useSchoolYears(canToggle)
  const { current, next } = currentAndNextYear(years.data ?? [], pacificTodayIso())

  const flagColumn = (title: string, year: YearRef | null, pick: (c: SchoolClass) => boolean) => ({
    title: year?.name ? `${title} (${year.name})` : title,
    key: title,
    render: (_: unknown, c: SchoolClass) => (canToggle ? (year ? <ActiveSwitch cls={c} year={year} checked={pick(c)} /> : null) : yesNo(pick(c))),
  })

  return (
    <>
      <Typography.Title level={3}>{t('classes.title')}</Typography.Title>
      {saved && <Alert type="success" showIcon title={t('common.saved')} role="status" style={{ marginBottom: 16 }} />}
      {can('school_classes.create') && (
        <Link to={PATHS.adminSchoolClassNew}>
          <Button type="primary" style={{ marginBottom: 16 }}>
            {t('classes.new')}
          </Button>
        </Link>
      )}
      <QueryBoundary query={classes}>
        {(data) => (
          <Table
            rowKey="id"
            dataSource={data}
            pagination={false}
            columns={[
              { title: t('classes.englishName'), dataIndex: 'englishName' },
              { title: t('classes.chineseName'), dataIndex: 'chineseName', render: (n: string | null) => (n ? <span lang="zh">{n}</span> : null) },
              { title: t('classes.type'), dataIndex: 'schoolClassType' },
              flagColumn(t('classes.activeCurrent'), current, (c) => c.activeCurrent),
              flagColumn(t('classes.activeNext'), next, (c) => c.activeNext),
              {
                title: '',
                key: 'edit',
                render: (_, c) => can('school_classes.edit') && <Link to={schoolClassEditPath(c.id)}>{t('common.edit')}</Link>,
              },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  )
}
