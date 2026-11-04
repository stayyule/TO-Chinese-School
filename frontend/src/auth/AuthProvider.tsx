import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useRef, type ReactNode } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { apiFetchNoRedirect, setUnauthorizedHandler, toApiError } from '../api/client'
import { isPublicPath } from '../routes/paths'
import { AuthContext, type AuthContextValue, type Me } from './useMe'

const ME_KEY = ['me'] as const

async function fetchMe(): Promise<Me | null> {
  const res = await apiFetchNoRedirect('/me')
  if (res.status === 401) return null
  if (!res.ok) throw await toApiError(res)
  return (await res.json()) as Me
}

/**
 * Holds the signed-in user. /me is requested only on protected paths (public pages never probe it), and any 401
 * from apiFetch navigates to /signin?returnTo=<current path> unless already on a public page.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const publicPage = isPublicPath(location.pathname)

  const query = useQuery({ queryKey: ME_KEY, queryFn: fetchMe, enabled: !publicPage })

  const current = useRef(location)
  useEffect(() => {
    current.current = location
  }, [location])

  useEffect(() => {
    setUnauthorizedHandler(() => {
      const loc = current.current
      if (isPublicPath(loc.pathname)) return
      queryClient.setQueryData(ME_KEY, null)
      void navigate(`/signin?returnTo=${encodeURIComponent(loc.pathname + loc.search)}`, { replace: true })
    })
    return () => setUnauthorizedHandler(null)
  }, [navigate, queryClient])

  const clear = useCallback(() => queryClient.removeQueries({ queryKey: ME_KEY }), [queryClient])

  const value = useMemo<AuthContextValue>(
    () => ({ me: query.data ?? null, loading: !publicPage && query.isPending, clear }),
    [query.data, query.isPending, publicPage, clear],
  )
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}
