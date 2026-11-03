import { Alert, Button, Card, Descriptions, Result, Space, Spin, Typography } from 'antd'
import { Link, useLocation } from 'react-router-dom'
import { t } from '../../i18n'
import { addChildPath, addParentPath, editPersonPath, familyAddressPath } from '../../routes/paths'
import { personName, useFamilies, type AddressView, type FamilyView, type PersonView } from './families'

function PersonLine({ person }: { person: PersonView }) {
  const birth = person.birthYear && person.birthMonth ? `${person.birthMonth}/${person.birthYear}` : null
  return (
    <Space wrap>
      <Typography.Text strong>{personName(person)}</Typography.Text>
      {person.chineseName && <Typography.Text lang="zh">{person.chineseName}</Typography.Text>}
      {birth && <Typography.Text type="secondary">{`${t('family.birth')} ${birth}`}</Typography.Text>}
      <Link to={editPersonPath(person.id)}>{t('family.editPerson')}</Link>
    </Space>
  )
}

function AddressBlock({ address }: { address: AddressView | null }) {
  if (!address) return <Typography.Paragraph type="secondary">{t('family.noAddress')}</Typography.Paragraph>
  return (
    <Descriptions column={1} size="small">
      <Descriptions.Item label={t('address.street')}>{address.street}</Descriptions.Item>
      <Descriptions.Item label={t('address.city')}>{address.city}</Descriptions.Item>
      <Descriptions.Item label={t('address.state')}>{address.state}</Descriptions.Item>
      <Descriptions.Item label={t('address.zipcode')}>{address.zipcode}</Descriptions.Item>
      <Descriptions.Item label={t('address.homePhone')}>{address.homePhone}</Descriptions.Item>
      {address.cellPhone && <Descriptions.Item label={t('address.cellPhone')}>{address.cellPhone}</Descriptions.Item>}
      <Descriptions.Item label={t('address.email')}>{address.email}</Descriptions.Item>
    </Descriptions>
  )
}

function FamilyCard({ family }: { family: FamilyView }) {
  return (
    <Card style={{ marginBottom: 16 }}>
      <Typography.Title level={4}>{t('family.parentOne')}</Typography.Title>
      {family.parentOne && <PersonLine person={family.parentOne} />}
      <Typography.Title level={4}>{t('family.parentTwo')}</Typography.Title>
      {family.parentTwo ? <PersonLine person={family.parentTwo} /> : <Link to={addParentPath(family.id)}>{t('family.addParent')}</Link>}
      <Typography.Title level={4}>{t('family.children')}</Typography.Title>
      {family.children.length === 0 && <Typography.Paragraph type="secondary">{t('family.noChildren')}</Typography.Paragraph>}
      <Space orientation="vertical" style={{ display: 'flex' }}>
        {family.children.map((c) => (
          <PersonLine key={c.id} person={c} />
        ))}
        <Link to={addChildPath(family.id)}>{t('family.addChild')}</Link>
      </Space>
      <Typography.Title level={4}>{t('family.address')}</Typography.Title>
      <AddressBlock address={family.address} />
      <Link to={familyAddressPath(family.id)}>{t('family.editAddress')}</Link>
    </Card>
  )
}

export function MyFamilyPage() {
  const { data, isPending, isError, refetch } = useFamilies()
  const location = useLocation()
  const saved = (location.state as { saved?: boolean } | null)?.saved === true

  if (isPending) return <Spin />
  if (isError) {
    return <Result status="error" title={t('family.loadFailed')} extra={<Button onClick={() => void refetch()}>{t('family.retry')}</Button>} />
  }
  return (
    <>
      <Typography.Title level={3}>{t('family.title')}</Typography.Title>
      {saved && <Alert type="success" showIcon title={t('family.saved')} role="status" style={{ marginBottom: 16 }} />}
      {data.length === 0 && <Typography.Paragraph>{t('family.none')}</Typography.Paragraph>}
      {data.map((f) => (
        <FamilyCard key={f.id} family={f} />
      ))}
    </>
  )
}
