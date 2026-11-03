import type { ReactNode } from 'react'
import { useMe } from './useMe'

/** Renders children only when the signed-in user holds `code` (UI hint only; the API enforces access). */
export function RequirePermission({ code, children }: { code: string; children: ReactNode }) {
  const { can } = useMe()
  return can(code) ? <>{children}</> : null
}
