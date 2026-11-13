import '@testing-library/jest-dom/vitest'
import { afterAll, afterEach, beforeAll } from 'vitest'
import { resetCsrfToken } from '../api/client'
import { server } from './server'

// Unhandled requests fail the test instead of silently hitting the network.
beforeAll(() => server.listen({ onUnhandledFrame: 'error' }))
afterEach(() => {
  server.resetHandlers()
  resetCsrfToken()
})
afterAll(() => server.close())

// jsdom lacks matchMedia, which Ant Design's responsive hooks call.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList
}

// jsdom lacks ResizeObserver, which Ant Design's Menu (rendered by AppLayout) observes.
if (!('ResizeObserver' in globalThis)) {
  globalThis.ResizeObserver = class {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  } as unknown as typeof ResizeObserver
}

// jsdom does not implement getComputedStyle(el, pseudoElement), which Ant Design's Table calls to measure scrollbars.
const realGetComputedStyle = window.getComputedStyle.bind(window)
window.getComputedStyle = (element: Element) => realGetComputedStyle(element)
