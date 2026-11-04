import { Button, Card, Space, Typography } from 'antd'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { staffFamilyPath } from '../../routes/paths'
import { NotFound } from '../NotFound'
import { QueryBoundary } from '../QueryBoundary'
import { personName } from '../parent/families'
import { personBody, useIdParam } from '../parent/helpers'
import { fill } from '../public/shared'
import { AddressBlock } from './blocks'
import { AddressFormCard, PersonFormCard } from './forms'
import { usePerson, type PersonDetail } from './staff'

type Editing = 'person' | 'address' | null

function PersonDetails({ person }: { person: PersonDetail }) {
  const { can } = useMe()
  const [editing, setEditing] = useState<Editing>(null)
  const close = () => setEditing(null)
  // Birth fields belong to children; for anyone else the stored values are sent back unchanged.
  const isChild = person.families.some((f) => f.children.some((c) => c.id === person.id))

  return (
    <>
      <Typography.Title level={3}>{personName(person)}</Typography.Title>
      {person.chineseName && (
        <Typography.Title level={4} lang="zh">
          {person.chineseName}
        </Typography.Title>
      )}
      {can('people.edit') && editing !== 'person' && (
        <Button onClick={() => setEditing('person')} style={{ marginBottom: 16 }}>
          {t('staff.person.edit')}
        </Button>
      )}
      {editing === 'person' && (
        <PersonFormCard
          title={t('staff.person.edit')}
          showBirth={isChild}
          initial={person}
          run={(v) =>
            apiJson(`/people/${person.id}`, {
              method: 'PATCH',
              body: JSON.stringify(personBody(isChild ? v : { ...v, birthYear: person.birthYear, birthMonth: person.birthMonth })),
            })
          }
          onDone={close}
          onCancel={close}
        />
      )}

      <Card title={t('family.address')} style={{ marginBottom: 16, maxWidth: 560 }}>
        <AddressBlock address={person.address} />
        {editing !== 'address' && person.address && can('people.address.edit') && (
          <Button onClick={() => setEditing('address')}>{t('family.editAddress')}</Button>
        )}
        {editing !== 'address' && !person.address && can('people.address.create') && (
          <Button onClick={() => setEditing('address')}>{t('staff.person.addAddress')}</Button>
        )}
      </Card>
      {editing === 'address' && (
        <AddressFormCard
          title={person.address ? t('family.editAddress') : t('staff.person.addAddress')}
          initial={person.address}
          method={person.address ? 'PATCH' : 'POST'}
          path={`/people/${person.id}/address`}
          onDone={close}
          onCancel={close}
        />
      )}

      <Typography.Title level={4}>{t('staff.person.families')}</Typography.Title>
      {person.families.length === 0 && <Typography.Paragraph type="secondary">{t('staff.person.noFamilies')}</Typography.Paragraph>}
      <Space orientation="vertical">
        {person.families.map((f) =>
          can('families.read') ? (
            <Link key={f.id} to={staffFamilyPath(f.id)}>
              {fill('staff.person.familyLink', { id: f.id })}
            </Link>
          ) : (
            <Typography.Text key={f.id}>{fill('staff.person.familyLink', { id: f.id })}</Typography.Text>
          ),
        )}
      </Space>
    </>
  )
}

function PersonLoader({ personId }: { personId: number }) {
  const query = usePerson(personId)
  return <QueryBoundary query={query}>{(person) => <PersonDetails person={person} />}</QueryBoundary>
}

export function PersonPage() {
  const personId = useIdParam('personId')
  if (personId === null) return <NotFound />
  return <PersonLoader personId={personId} />
}
