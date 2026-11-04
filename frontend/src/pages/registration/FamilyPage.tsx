import { Button, Card, Space, Typography } from 'antd'
import { useState } from 'react'
import { apiJson } from '../../api/client'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { QueryBoundary } from '../QueryBoundary'
import type { FamilyView } from '../parent/families'
import { personBody, useIdParam } from '../parent/helpers'
import { AddressBlock, PersonLine } from './blocks'
import { AddressFormCard, PersonFormCard } from './forms'
import { useFamily } from './staff'

type Editing = 'parent' | 'child' | 'address' | null

function FamilyDetails({ family }: { family: FamilyView }) {
  const { can } = useMe()
  const [editing, setEditing] = useState<Editing>(null)
  const close = () => setEditing(null)
  const post = (path: string) => (v: Parameters<typeof personBody>[0]) => apiJson(`/families/${family.id}/${path}`, { method: 'POST', body: JSON.stringify(personBody(v)) })

  return (
    <>
      <Typography.Title level={3}>{t('staff.family.title')}</Typography.Title>
      <Card style={{ marginBottom: 16, maxWidth: 560 }}>
        <Typography.Title level={4}>{t('family.parentOne')}</Typography.Title>
        {family.parentOne && <PersonLine person={family.parentOne} />}
        <Typography.Title level={4}>{t('family.parentTwo')}</Typography.Title>
        {family.parentTwo ? (
          <PersonLine person={family.parentTwo} />
        ) : (
          editing !== 'parent' && can('families.parent.add') && <Button onClick={() => setEditing('parent')}>{t('family.addParent')}</Button>
        )}
        <Typography.Title level={4}>{t('family.children')}</Typography.Title>
        {family.children.length === 0 && <Typography.Paragraph type="secondary">{t('family.noChildren')}</Typography.Paragraph>}
        <Space orientation="vertical" style={{ display: 'flex' }}>
          {family.children.map((c) => (
            <PersonLine key={c.id} person={c} />
          ))}
          {editing !== 'child' && can('families.child.add') && <Button onClick={() => setEditing('child')}>{t('family.addChild')}</Button>}
        </Space>
        <Typography.Title level={4}>{t('family.address')}</Typography.Title>
        <AddressBlock address={family.address} />
        {editing !== 'address' && can('families.address.edit') && <Button onClick={() => setEditing('address')}>{t('family.editAddress')}</Button>}
      </Card>

      {editing === 'parent' && (
        <PersonFormCard
          title={t('staff.family.addParentTitle')}
          showBirth={false}
          run={post('parents')}
          onDone={close}
          onCancel={close}
          messages={{ PARENT_TWO_EXISTS: 'family.parentTwoExists' }}
        />
      )}
      {editing === 'child' && <PersonFormCard title={t('staff.family.addChildTitle')} showBirth run={post('children')} onDone={close} onCancel={close} />}
      {editing === 'address' && (
        <AddressFormCard title={t('family.editAddress')} initial={family.address} method="PATCH" path={`/families/${family.id}/address`} onDone={close} onCancel={close} />
      )}
    </>
  )
}

function FamilyLoader({ familyId }: { familyId: number }) {
  const query = useFamily(familyId)
  return <QueryBoundary query={query}>{(family) => <FamilyDetails family={family} />}</QueryBoundary>
}

export function FamilyPage() {
  const familyId = useIdParam('familyId')
  if (familyId === null) return <NotFound />
  return <FamilyLoader familyId={familyId} />
}
