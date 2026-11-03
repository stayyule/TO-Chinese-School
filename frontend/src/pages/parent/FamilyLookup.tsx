import { Button, Result, Spin } from 'antd'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { useFamilies, type FamilyView } from './families'
import { useIdParam } from './helpers'

/** Resolves :familyId against the user's own families; non-numeric or unknown ids render NotFound. */
export function FamilyLookup({ children }: { children: (family: FamilyView) => ReactNode }) {
  const familyId = useIdParam('familyId')
  const { data, isPending, isError, refetch } = useFamilies()
  if (familyId === null) return <NotFound />
  if (isPending) return <Spin />
  if (isError) {
    return <Result status="error" title={t('family.loadFailed')} extra={<Button onClick={() => void refetch()}>{t('family.retry')}</Button>} />
  }
  const family = data.find((f) => f.id === familyId)
  return family ? <>{children(family)}</> : <NotFound />
}
