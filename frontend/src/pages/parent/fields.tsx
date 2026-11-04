import { Alert, Button, Form, Input, InputNumber, Radio, Space } from 'antd'
import { Link } from 'react-router-dom'
import { t } from '../../i18n'
import { PATHS } from '../../routes/paths'
import { requiredRule } from '../public/shared'
import { MAX_BIRTH_YEAR, digitCount } from './helpers'

/** Save button plus Cancel: a link (path, default the parent family page) or a button when given a callback. */
export function FormActions({ busy, cancelTo = PATHS.parentFamily, saveLabel = t('common.save') }: { busy: boolean; cancelTo?: string | (() => void); saveLabel?: string }) {
  return (
    <Space>
      <Button type="primary" htmlType="submit" loading={busy}>
        {saveLabel}
      </Button>
      {typeof cancelTo === 'function' ? (
        <Button type="link" onClick={cancelTo}>
          {t('family.cancel')}
        </Button>
      ) : (
        <Link to={cancelTo}>{t('family.cancel')}</Link>
      )}
    </Space>
  )
}

export function FormError({ message }: { message: string | null }) {
  return message ? <Alert type="error" showIcon title={message} role="alert" style={{ marginBottom: 16 }} /> : null
}

/** Birth fields are shown (and required) for children only; parents keep any stored values unchanged. */
export function PersonFields({ showBirth, prefix = [] }: { showBirth: boolean; prefix?: string[] }) {
  const maxYear = MAX_BIRTH_YEAR
  return (
    <>
      <Form.Item name={[...prefix, 'englishFirstName']} label={t('person.englishFirstName')} rules={[requiredRule]}>
        <Input />
      </Form.Item>
      <Form.Item name={[...prefix, 'englishLastName']} label={t('person.englishLastName')} rules={[requiredRule]}>
        <Input />
      </Form.Item>
      <Form.Item name={[...prefix, 'chineseName']} label={t('person.chineseName')}>
        <Input lang="zh" />
      </Form.Item>
      <Form.Item name={[...prefix, 'gender']} label={t('person.gender')} rules={[{ required: true, message: t('error.required') }]}>
        <Radio.Group
          options={[
            { value: 'M', label: t('person.male') },
            { value: 'F', label: t('person.female') },
          ]}
        />
      </Form.Item>
      <Form.Item name={[...prefix, 'nativeLanguage']} label={t('person.nativeLanguage')}>
        <Input />
      </Form.Item>
      {showBirth && (
        <>
          <Form.Item
            name={[...prefix, 'birthYear']}
            label={t('person.birthYear')}
            rules={[
              { required: true, message: t('error.required') },
              { type: 'integer', min: 1901, max: maxYear, message: t('person.birthYearRange') },
            ]}
          >
            <InputNumber precision={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name={[...prefix, 'birthMonth']}
            label={t('person.birthMonth')}
            rules={[
              { required: true, message: t('error.required') },
              { type: 'integer', min: 1, max: 12, message: t('error.OUT_OF_RANGE') },
            ]}
          >
            <InputNumber precision={0} controls={false} style={{ width: '100%' }} />
          </Form.Item>
        </>
      )}
    </>
  )
}

export function AddressFields({ prefix = [] }: { prefix?: string[] }) {
  return (
    <>
      <Form.Item name={[...prefix, 'street']} label={t('address.street')} rules={[requiredRule]}>
        <Input autoComplete="address-line1" />
      </Form.Item>
      <Form.Item name={[...prefix, 'city']} label={t('address.city')} rules={[requiredRule]}>
        <Input autoComplete="address-level2" />
      </Form.Item>
      <Form.Item name={[...prefix, 'state']} label={t('address.state')} rules={[requiredRule]}>
        <Input autoComplete="address-level1" />
      </Form.Item>
      <Form.Item name={[...prefix, 'zipcode']} label={t('address.zipcode')} rules={[requiredRule, { pattern: /^\d{1,5}$/, message: t('address.zipcodeFormat') }]}>
        <Input autoComplete="postal-code" inputMode="numeric" maxLength={5} />
      </Form.Item>
      <Form.Item
        name={[...prefix, 'homePhone']}
        label={t('address.homePhone')}
        rules={[
          requiredRule,
          { validator: (_, v: string | undefined) => (!v || digitCount(v) === 10 ? Promise.resolve() : Promise.reject(new Error(t('address.homePhoneFormat')))) },
        ]}
      >
        <Input autoComplete="tel" inputMode="tel" />
      </Form.Item>
      <Form.Item
        name={[...prefix, 'cellPhone']}
        label={t('address.cellPhone')}
        rules={[{ validator: (_, v: string | undefined) => (!v || digitCount(v) > 0 ? Promise.resolve() : Promise.reject(new Error(t('address.cellPhoneFormat')))) }]}
      >
        <Input autoComplete="tel" inputMode="tel" />
      </Form.Item>
      <Form.Item name={[...prefix, 'email']} label={t('address.email')} rules={[requiredRule, { type: 'email', message: t('error.INVALID') }]}>
        <Input autoComplete="email" inputMode="email" />
      </Form.Item>
    </>
  )
}
