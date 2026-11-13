import { Spin } from 'antd'
import { Navigate, Outlet, useLocation } from 'react-router-dom'
import { AuthProvider } from '../auth/AuthProvider'
import { useMe } from '../auth/useMe'

export function Root() {
  return (
    <AuthProvider>
      <Outlet />
    </AuthProvider>
  )
}

/** Gate for every protected group: waits for /me, then sends anonymous visitors to /signin?returnTo=<path>. */
export function RequireAuth() {
  const { me, loading } = useMe()
  const location = useLocation()
  if (loading) return <Spin fullscreen />
  if (!me) {
    return <Navigate to={`/signin?returnTo=${encodeURIComponent(location.pathname + location.search)}`} replace />
  }
  return <Outlet />
}
