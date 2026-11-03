import type { ReactNode } from 'react'
import { Outlet } from 'react-router-dom'
import { useMe } from '../auth/useMe'
import { Forbidden } from '../pages/Forbidden'

/**
 * Route wrapper: renders the page only when the signed-in user holds  (or any of ), otherwise the
 * Forbidden page. Use as an element around a page (children) or as a layout route (Outlet). UI hint only; the API
 * enforces access.
 */
export function RequireRoutePermission({ code, anyOf, children }: { code?: string; anyOf?: string[]; children?: ReactNode }) {
  const { can } = useMe()
  const allowed = [...(code ? [code] : []), ...(anyOf ?? [])].some(can)
  if (!allowed) return <Forbidden />
  return <>{children ?? <Outlet />}</>
}
