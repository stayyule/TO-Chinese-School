import { Descriptions, Space, Typography } from 'antd'
import { Link } from 'react-router-dom'
import { useMe } from '../../auth/useMe'
import { t } from '../../i18n'
import { staffPersonPath } from '../../routes/paths'
import { personName, type AddressView, type PersonView } from '../parent/families'

export function AddressBlock({ address }: { address: AddressView | null }) {
  if (!address) return <Typography.Paragraph type="secondary">{t('staff.person.noAddress')}</Typography.Paragraph>
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

/** A person's names (English linking to their page when the user may read people) and birth month/year. */
export function PersonLine({ person }: { person: PersonView }) {
  const { can } = useMe()
  const name = personName(person)
  const birth = person.birthYear && person.birthMonth ? `${person.birthMonth}/${person.birthYear}` : null
  return (
    <Space wrap>
      {can('people.read') ? <Link to={staffPersonPath(person.id)}>{name}</Link> : <Typography.Text strong>{name}</Typography.Text>}
      {person.chineseName && <Typography.Text lang="zh">{person.chineseName}</Typography.Text>}
      {birth && <Typography.Text type="secondary">{`${t('family.birth')} ${birth}`}</Typography.Text>}
    </Space>
  )
}
