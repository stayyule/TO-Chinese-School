import type { FormInstance } from 'antd'
import { ApiError, toApiError } from '../../api/client'
import { t, type MessageKey } from '../../i18n'

export const MIN_PASSWORD_LENGTH = 10

/** Whole minutes (at least 1) to wait for a Retry-After value in seconds. */
export function minutesFromSeconds(seconds: number): number {
  return Math.max(1, Math.ceil(seconds / 60))
}

export function fill(key: MessageKey, values: Record<string, string | number>): string {
  return Object.entries(values).reduce((s, [k, v]) => s.replace(`{${k}}`, String(v)), t(key))
}

/** Wait time in minutes for a 429: the Retry-After header, else details.retryAfterSeconds, else one minute. */
export function lockMinutes(err: ApiError, retryAfter: number | null): number {
  const fromBody = Number((err.details as { retryAfterSeconds?: unknown } | null)?.retryAfterSeconds)
  return minutesFromSeconds(retryAfter ?? (Number.isFinite(fromBody) && fromBody > 0 ? fromBody : 60))
}

/** ApiError from a Response, plus the Retry-After header in seconds (null when absent or invalid). */
export async function readError(res: Response): Promise<{ error: ApiError; retryAfter: number | null }> {
  const error = await toApiError(res)
  const raw = Number(res.headers.get('Retry-After'))
  return { error, retryAfter: Number.isFinite(raw) && raw > 0 ? raw : null }
}

export interface FieldTarget {
  field: string[]
  key: MessageKey
}

const CODE_KEYS: Record<string, MessageKey> = {
  REQUIRED: 'error.REQUIRED',
  TOO_LONG: 'error.TOO_LONG',
  INVALID: 'error.INVALID',
  OUT_OF_RANGE: 'error.OUT_OF_RANGE',
}

/** Puts 422 `details` entries (keys like "address.zipcode") onto the matching form fields. Returns true if any. */
export function applyDetails(form: FormInstance, err: ApiError): boolean {
  const d = err.details
  if (err.code !== 'VALIDATION_ERROR' || typeof d !== 'object' || d === null || Array.isArray(d)) return false
  const fields = Object.entries(d as Record<string, unknown>).map(([key, code]) => ({
    name: key.split('.'),
    errors: [t(CODE_KEYS[String(code)] ?? 'error.INVALID')],
  }))
  form.setFields(fields)
  return fields.length > 0
}

/**
 * Maps an API error onto the form: known codes onto `targets` fields, 422 details onto their fields. Returns a
 * form-level message when the error was not placed on a field.
 */
export function placeError(form: FormInstance, err: unknown, targets: Record<string, FieldTarget>): string | null {
  if (!(err instanceof ApiError)) return t('common.genericError')
  const target = targets[err.code]
  if (target) {
    form.setFields([{ name: target.field, errors: [t(target.key)] }])
    return null
  }
  if (applyDetails(form, err)) return null
  return t('common.genericError')
}

/** Field errors shared by every "set a password" form. */
export const PASSWORD_TARGETS: Record<string, FieldTarget> = {
  PASSWORD_MISMATCH: { field: ['passwordConfirmation'], key: 'error.passwordMismatch' },
  PASSWORD_TOO_SHORT: { field: ['password'], key: 'error.passwordTooShort' },
  PHONE_MISMATCH: { field: ['phoneNumber'], key: 'error.phoneMismatch' },
}

export const requiredRule = { required: true, whitespace: true, message: t('error.required') }

export const passwordRules = [
  { required: true, message: t('error.required') },
  { min: MIN_PASSWORD_LENGTH, message: t('error.passwordTooShort') },
]
