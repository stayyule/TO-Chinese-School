import { useQueryClient } from '@tanstack/react-query'
import type { FormInstance } from 'antd'
import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ApiError } from '../../api/client'
import { t, type MessageKey } from '../../i18n'
import { PATHS } from '../../routes/paths'
import { placeError } from '../public/shared'
import { FAMILIES_KEY, type AddressView, type PersonView } from './families'

/** A numeric route param (digits only), or null. Pages render NotFound for null before any API call. */
export function useIdParam(name: string): number | null {
  const raw = useParams()[name]
  return raw !== undefined && /^\d{1,9}$/.test(raw) ? Number(raw) : null
}

/**
 * Submit handling shared by the parent forms: double-submit guard, 404 -> notFound, 422 details onto fields,
 * and on success refresh the families query and return to /parent/family with a notice.
 */
export function useSubmit<V>(form: FormInstance<V>, run: (values: V) => Promise<unknown>, errorKeys: Record<string, MessageKey> = {}) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const submit = async (values: V) => {
    if (busy) return
    setBusy(true)
    setError(null)
    try {
      await run(values)
      await queryClient.invalidateQueries({ queryKey: FAMILIES_KEY })
      await navigate(PATHS.parentFamily, { state: { saved: true } })
    } catch (e) {
      if (e instanceof ApiError && e.status === 404) setNotFound(true)
      else if (e instanceof ApiError && errorKeys[e.code]) setError(t(errorKeys[e.code] as MessageKey))
      else setError(placeError(form, e, {}))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, notFound, submit }
}

export interface PersonValues {
  englishFirstName: string
  englishLastName: string
  chineseName?: string
  gender: 'M' | 'F'
  nativeLanguage?: string
  birthYear?: number | null
  birthMonth?: number | null
}

const trim = (s: string | undefined) => (s ?? '').trim()

/** Request body for a person: strings trimmed (as typed otherwise), birth values as numbers (or null). */
export function personBody(v: PersonValues) {
  return {
    englishFirstName: trim(v.englishFirstName),
    englishLastName: trim(v.englishLastName),
    chineseName: trim(v.chineseName),
    gender: v.gender,
    nativeLanguage: trim(v.nativeLanguage),
    birthYear: v.birthYear ?? null,
    birthMonth: v.birthMonth ?? null,
  }
}

export function personInitial(p: PersonView | null): Partial<PersonValues> {
  if (!p) return {}
  return {
    englishFirstName: p.englishFirstName ?? '',
    englishLastName: p.englishLastName ?? '',
    chineseName: p.chineseName ?? '',
    gender: p.gender === 'M' || p.gender === 'F' ? p.gender : undefined,
    nativeLanguage: p.nativeLanguage ?? '',
    birthYear: p.birthYear,
    birthMonth: p.birthMonth,
  }
}

export interface AddressValues {
  street: string
  city: string
  state: string
  zipcode: string
  homePhone: string
  cellPhone?: string
  email: string
}

export function addressInitial(a: AddressView | null): Partial<AddressValues> {
  if (!a) return {}
  return {
    street: a.street ?? '',
    city: a.city ?? '',
    state: a.state ?? '',
    zipcode: a.zipcode ?? '',
    homePhone: a.homePhone ?? '',
    cellPhone: a.cellPhone ?? '',
    email: a.email ?? '',
  }
}

export function addressBody(v: AddressValues) {
  return {
    street: trim(v.street),
    city: trim(v.city),
    state: trim(v.state),
    zipcode: trim(v.zipcode),
    homePhone: trim(v.homePhone),
    cellPhone: trim(v.cellPhone),
    email: trim(v.email),
  }
}

/** Latest plausible birth year (the API requires a year before the current one). */
export const MAX_BIRTH_YEAR = new Date().getFullYear() - 1

export const digitCount = (s: string) => s.replace(/\D/g, '').length
