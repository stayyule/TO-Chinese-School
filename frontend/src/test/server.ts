import { setupServer } from 'msw/node'

/** Shared MSW server; tests add per-test handlers with server.use(...). */
export const server = setupServer()
