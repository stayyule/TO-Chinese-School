import { t } from '../../i18n'
import { parseMoneyInput } from '../../lib/money'
import { requiredRule } from '../public/shared'

/** Form rules for a required dollar amount. */
export const moneyRules = [
  requiredRule,
  { validator: (_: unknown, v: string | undefined) => (!v || !v.trim() || parseMoneyInput(v) !== null ? Promise.resolve() : Promise.reject(new Error(t('year.moneyFormat')))) },
]
