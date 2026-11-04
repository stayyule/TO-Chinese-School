import type { UseQueryResult } from '@tanstack/react-query'
import { Button, Result, Spin } from 'antd'
import type { ReactNode } from 'react'
import { ApiError } from '../api/client'
import { t } from '../i18n'
import { NotFound } from './NotFound'

/** Loading spinner, Not found for an API 404, a retry state for other errors, else the rendered data. */
export function QueryBoundary<T>({ query, children }: { query: UseQueryResult<T>; children: (data: T) => ReactNode }) {
  if (query.isPending) return <Spin />
  if (query.isError) {
    if (query.error instanceof ApiError && query.error.status === 404) return <NotFound />
    return <Result status="error" title={t('common.loadFailed')} extra={<Button onClick={() => void query.refetch()}>{t('family.retry')}</Button>} />
  }
  return <>{children(query.data)}</>
}
