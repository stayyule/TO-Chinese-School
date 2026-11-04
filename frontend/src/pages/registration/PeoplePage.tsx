import { Input, Table, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { fill } from '../public/shared'
import { t } from '../../i18n'
import { useDebouncedValue } from '../../lib/useDebouncedValue'
import { staffPersonPath } from '../../routes/paths'
import { QueryBoundary } from '../QueryBoundary'
import { personName } from '../parent/families'
import { PEOPLE_PAGE_SIZE, usePeople } from './staff'

const SEARCH_DELAY_MS = 300
const MAX_QUERY_LENGTH = 100

/** Registration officer people search: debounced text query, server-side paging. */
export function PeoplePage() {
  const [text, setText] = useState('')
  const query = useDebouncedValue(text, SEARCH_DELAY_MS).trim()
  // The page belongs to the query it was chosen for; a new query starts again at page 1.
  const [chosen, setChosen] = useState({ query: '', page: 1 })
  const page = chosen.query === query ? chosen.page : 1
  const people = usePeople(query, page)

  return (
    <>
      <Typography.Title level={3}>{t('staff.people.title')}</Typography.Title>
      <Input
        type="search"
        aria-label={t('staff.people.search')}
        placeholder={t('staff.people.searchHelp')}
        value={text}
        maxLength={MAX_QUERY_LENGTH}
        onChange={(e) => setText(e.target.value)}
        style={{ maxWidth: 420, marginBottom: 16 }}
      />
      <QueryBoundary query={people}>
        {(data) => (
          <Table
            rowKey="id"
            dataSource={data.items}
            loading={people.isFetching}
            pagination={{
              current: page,
              pageSize: PEOPLE_PAGE_SIZE,
              total: data.total,
              showSizeChanger: false,
              showTotal: (total) => fill('staff.people.total', { total }),
              onChange: (next) => setChosen({ query, page: next }),
            }}
            columns={[
              {
                title: t('staff.people.englishName'),
                key: 'english',
                render: (_, p) => <Link to={staffPersonPath(p.id)}>{personName(p)}</Link>,
              },
              {
                title: t('person.chineseName'),
                dataIndex: 'chineseName',
                render: (name: string | null) => (name ? <span lang="zh">{name}</span> : null),
              },
            ]}
          />
        )}
      </QueryBoundary>
    </>
  )
}
