import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom'
import { AppLayout } from '../layout/AppLayout'
import { NotFound } from '../pages/NotFound'
import { Placeholder } from '../pages/Placeholder'
import { RequireAuth, Root } from './guards'
import { PublicPlaceholder } from '../pages/PublicPlaceholder'
import { SignInPage } from '../pages/SignInPage'

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: '/signin', element: <SignInPage /> },
      { path: '/register', element: <PublicPlaceholder name="Register" /> },
      { path: '/forgot-password', element: <PublicPlaceholder name="Forgot password" /> },
      { path: '/forgot-username', element: <PublicPlaceholder name="Forgot username" /> },
      { path: '/reset-password/:token', element: <PublicPlaceholder name="Reset password" /> },
      { path: '/register-with-invitation/:token', element: <PublicPlaceholder name="Register with invitation" /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Placeholder title="nav.home" /> },
              { path: 'parent/*', element: <Placeholder title="nav.parent" /> },
              { path: 'registration/*', element: <Placeholder title="nav.registration" /> },
              { path: 'accounting/*', element: <Placeholder title="nav.accounting" /> },
              { path: 'admin/*', element: <Placeholder title="nav.admin" /> },
              { path: 'instruction/*', element: <Placeholder title="nav.instruction" /> },
              { path: 'communication/*', element: <Placeholder title="nav.communication" /> },
              { path: '*', element: <NotFound /> },
            ],
          },
        ],
      },
    ],
  },
]

export const createAppRouter = (initialEntries?: string[]) =>
  initialEntries ? createMemoryRouter(routes, { initialEntries }) : createBrowserRouter(routes)
