import { en, type MessageKey } from './en'

/** Looks up a user-visible string by key (English catalog). */
export function t(key: MessageKey): string {
  return en[key]
}

export type { MessageKey }
