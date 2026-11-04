import { createContext, useContext } from 'react'

export interface Me {
  user: { id: number; username: string | null }
  person: { id: number; englishName: string; chineseName: string | null } | null
  roles: string[]
  permissions: string[]
}

export interface AuthContextValue {
  me: Me | null
  loading: boolean
  /** Drops the cached user so the next protected page re-reads /me (call after login and logout). */
  clear: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useMe(): { me: Me | null; loading: boolean; can: (code: string) => boolean } {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useMe must be used inside <AuthProvider>')
  const { me, loading } = ctx
  return { me, loading, can: (code: string) => me?.permissions.includes(code) ?? false }
}

export function useAuthActions(): Pick<AuthContextValue, 'clear'> {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuthActions must be used inside <AuthProvider>')
  return { clear: ctx.clear }
}
