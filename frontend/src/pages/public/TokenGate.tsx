import { useQuery } from '@tanstack/react-query'
import { Result, Spin } from 'antd'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { ApiError, apiJson } from '../../api/client'
import { t, type MessageKey } from '../../i18n'
import { AuthShell, ErrorAlert } from './AuthShell'

/** Calls a token-check endpoint first and renders `children(data)` only for a usable link. */
export function TokenGate<T>({
  checkPath,
  queryKey,
  title,
  invalid,
  recoveryLink,
  children,
}: {
  checkPath: string
  queryKey: string
  title: MessageKey
  invalid: MessageKey
  recoveryLink?: { to: string; label: MessageKey }
  children: (data: T) => ReactNode
}) {
  const check = useQuery({
    queryKey: [queryKey, checkPath],
    queryFn: () => apiJson<T>(checkPath),
    retry: false,
    gcTime: 0,
    refetchOnWindowFocus: false,
  })
  const notFound = check.error instanceof ApiError && check.error.status === 404
  const link = recoveryLink ?? { to: '/signin', label: 'common.backToSignIn' as MessageKey }

  return (
    <AuthShell title={t(title)}>
      {check.isPending && <Spin description={t('common.checkingLink')} />}
      {notFound && <Result status="warning" title={t(invalid)} extra={<Link to={link.to}>{t(link.label)}</Link>} />}
      {check.isError && !notFound && <ErrorAlert message={t('common.genericError')} />}
      {check.isSuccess && children(check.data)}
    </AuthShell>
  )
}
