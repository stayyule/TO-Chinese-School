import type { FormInstance } from 'antd'
import { useRef, useState } from 'react'
import { ApiError } from '../api/client'
import { t, type MessageKey } from '../i18n'
import { placeError, type FieldTarget } from './public/shared'

export interface SubmitOptions {
  /** Runs after `run` succeeded (refresh queries, navigate, close a form...). */
  onSuccess?: () => void | Promise<void>
  /** Error codes shown as a form-level message. */
  messages?: Record<string, MessageKey>
  /** Error codes shown on a field; 422 `details` always go onto their fields. */
  targets?: Record<string, FieldTarget>
}

/**
 * Submit handling for the staff and admin forms: a double-submit guard (a ref, so two clicks in one tick cannot both
 * pass), a 404 flag so the page can render Not found, then the mapping of API errors onto fields or the form.
 */
export function useFormSubmit<V>(form: FormInstance<V>, run: (values: V) => Promise<unknown>, options: SubmitOptions = {}) {
  const inflight = useRef(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notFound, setNotFound] = useState(false)

  const submit = async (values: V) => {
    if (inflight.current) return
    inflight.current = true
    setBusy(true)
    setError(null)
    try {
      await run(values)
      await options.onSuccess?.()
    } catch (e) {
      const known = e instanceof ApiError ? options.messages?.[e.code] : undefined
      if (known) setError(t(known))
      else if (e instanceof ApiError && e.status === 404 && !options.targets?.[e.code]) setNotFound(true)
      else setError(placeError(form, e, options.targets ?? {}))
    } finally {
      inflight.current = false
      setBusy(false)
    }
  }
  return { busy, error, notFound, submit }
}
