import { useQuery } from '@tanstack/react-query'
import { Table, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { t } from '../../i18n'
import { roleDetailPath } from '../../routes/paths'
import { QueryBoundary } from '../QueryBoundary'

interface RoleSummary {
  id: number
  name: string | null
  userCount: number
}

export function RolesPage() {
  const query = useQuery({ queryKey: ['roles'], queryFn: () => apiJson<RoleSummary[]>('/roles') })
  return (
    <>
      <Typography.Title level={3}>{t('roles.title')}</Typography.Title>
      <QueryBoundary query={query}>
        {(roles) => (
          <Table
            rowKey="id"
            dataSource={roles}
            pagination={false}
            columns={[
              { title: t('roles.name'), key: 'name', render: (_, r) => <Link to={roleDetailPath(r.id)}>{r.name ?? String(r.id)}</Link> },
              { title: t('roles.userCount'), dataIndex: 'userCount' },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  )
}
