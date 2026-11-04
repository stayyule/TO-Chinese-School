import { useQueryClient } from '@tanstack/react-query'
import { Alert, Button, Space, Switch, Table, Typography } from 'antd'
import { useRef, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { formatCents } from '../../lib/money'
import { PATHS, bookChargesPath, schoolYearEditPath } from '../../routes/paths'
import { QueryBoundary } from '../QueryBoundary'
import { fill } from '../public/shared'
import { SCHOOL_YEARS_KEY, useSchoolYears, type SchoolYear } from './years'

/** Switch for a year's automatic class assignment; one request at a time. */
function AutoClassSwitch({ year }: { year: SchoolYear }) {
  const queryClient = useQueryClient()
  const inflight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const toggle = async () => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setFailed(false)
    try {
      await apiJson(`/school-years/${year.id}/auto-class-assignment/toggle`, { method: 'POST' })
      await queryClient.invalidateQueries({ queryKey: SCHOOL_YEARS_KEY })
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
        checked={year.autoClassAssignment}
        loading={busy}
        aria-label={fill('year.autoClassLabel', { name: year.name ?? String(year.id) })}
        onChange={() => void toggle()}
      />
      {failed && <Typography.Text type="danger">{t('common.genericError')}</Typography.Text>}
    </Space>
  )
}

export function SchoolYearsPage() {
  const { can } = useMe()
  const location = useLocation()
  const saved = (location.state as { saved?: boolean } | null)?.saved === true
  const years = useSchoolYears()
  return (
    <>
      <Typography.Title level={3}>{t('year.listTitle')}</Typography.Title>
      {saved && <Alert type="success" showIcon title={t('common.saved')} role="status" style={{ marginBottom: 16 }} />}
      {can('school_years.create') && (
        <Link to={PATHS.adminSchoolYearNew}>
          <Button type="primary" style={{ marginBottom: 16 }}>
            {t('year.new')}
          </Button>
        </Link>
      )}
      <QueryBoundary query={years}>
        {(data) => (
          <Table
            rowKey="id"
            dataSource={data}
            pagination={false}
            columns={[
              { title: t('year.name'), dataIndex: 'name' },
              { title: t('year.startDate'), dataIndex: 'startDate' },
              { title: t('year.endDate'), dataIndex: 'endDate' },
              { title: t('year.tuition'), dataIndex: 'tuition', render: (cents: number) => formatCents(cents) },
              ...(can('school_years.auto_class_assignment.toggle')
                ? [{ title: t('year.autoClass'), key: 'auto', render: (_: unknown, y: SchoolYear) => <AutoClassSwitch year={y} /> }]
                : []),
              {
                title: '',
                key: 'actions',
                render: (_, y) => (
                  <Space>
                    {can('school_years.edit') && <Link to={schoolYearEditPath(y.id)}>{t('common.edit')}</Link>}
                    <Link to={bookChargesPath(y.id)}>{t('year.bookCharges')}</Link>
                  </Space>
                ),
              },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  )
}
