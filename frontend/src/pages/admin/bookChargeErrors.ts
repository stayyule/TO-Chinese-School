import { ApiError } from '../../api/client'

/**
 * A 422 whose details are keyed `items.<i>[.field]` refers to the i-th row that was sent; re-key it to that grade's
 * form field (`charges.<id>`). Details that match no sent row are dropped; with none left the error is generic.
 */
export function remapItemErrors(err: ApiError, sentIds: number[]): ApiError {
  const d = err.details
  if (err.code !== 'VALIDATION_ERROR' || typeof d !== 'object' || d === null || Array.isArray(d)) return err
  const details: Record<string, unknown> = {}
  for (const [key, code] of Object.entries(d as Record<string, unknown>)) {
    const m = /^items\.(\d+)/.exec(key)
    const id = m ? sentIds[Number(m[1])] : undefined
    if (id !== undefined) details[`charges.${id}`] = code
  }
  if (Object.keys(details).length === 0) return new ApiError(err.status, 'HTTP_ERROR', err.message)
  return new ApiError(err.status, err.code, err.message, details)
}
