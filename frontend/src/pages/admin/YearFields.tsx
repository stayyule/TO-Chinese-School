import { Form, Input, InputNumber, Typography } from 'antd'
import { t } from '../../i18n'
import { moneyRules } from './moneyRules'
import { requiredRule } from '../public/shared'
import { DATE_FIELDS, MONEY_FIELDS, type DateField } from './years'

/** The school-year inputs: dates (frozen ones disabled) and fees in dollars. */
export function YearFields({ frozen }: { frozen: ReadonlySet<DateField> }) {
  return (
    <>
      <Form.Item name="name" label={t('year.name')} rules={[requiredRule]}>
        <Input />
      </Form.Item>
      <Form.Item name="description" label={t('year.description')}>
        <Input />
      </Form.Item>
      <Form.Item
        name="ageCutoffMonth"
        label={t('year.ageCutoffMonth')}
        rules={[{ required: true, message: t('error.required') }, { type: 'integer', min: 1, max: 12, message: t('error.OUT_OF_RANGE') }]}
      >
        <InputNumber precision={0} controls={false} style={{ width: '100%' }} />
      </Form.Item>

      <Typography.Title level={4}>{t('year.dates')}</Typography.Title>
      {frozen.size > 0 && <Typography.Paragraph type="secondary">{t('year.frozenHelp')}</Typography.Paragraph>}
      {DATE_FIELDS.map(([field, label]) => (
        <Form.Item key={field} name={field} label={t(label)} rules={[requiredRule]}>
          <Input type="date" disabled={frozen.has(field) ? true : undefined} />
        </Form.Item>
      ))}

      <Typography.Title level={4}>{t('year.fees')}</Typography.Title>
      {MONEY_FIELDS.map(([field, label]) => (
        <Form.Item key={field} name={field} label={t(label)} rules={moneyRules}>
          <Input inputMode="decimal" autoComplete="off" />
        </Form.Item>
      ))}
    </>
  )
}
