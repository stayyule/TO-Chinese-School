import { Button, Result, Spin } from 'antd'
import type { ReactNode } from 'react'
import { t } from '../../i18n'
import { NotFound } from '../NotFound'
import { useFamilies, type FamilyView } from './families'
import { useIdParam } from './helpers'

function Resolve({ familyId, children }: { familyId: number; children: (family: FamilyView) => ReactNode }) {
  const { data, isPending, isError, refetch } = useFamilies()
  if (isPending) return <Spin />
  if (isError) {
    return <Result status="error" title={t('family.loadFailed')} extra={<Button onClick={() => void refetch()}>{t('family.retry')}</Button>} />
  }
  const family = data.find((f) => f.id === familyId)
  return family ? <>{children(family)}</> : <NotFound />
}

/** Resolves :familyId against the user's own families; a non-numeric id renders NotFound before any request is made. */
export function FamilyLookup({ children }: { children: (family: FamilyView) => ReactNode }) {
  const familyId = useIdParam('familyId')
  if (familyId === null) return <NotFound />
  return <Resolve familyId={familyId}>{children}</Resolve>
}
