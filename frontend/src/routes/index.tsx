import { createBrowserRouter, createMemoryRouter, type RouteObject } from 'react-router-dom'
import { AppLayout } from '../layout/AppLayout'
import { NotFound } from '../pages/NotFound'
import { Placeholder } from '../pages/Placeholder'
import { RequireAuth, Root } from './guards'
import { ChangePasswordPage } from '../pages/account/ChangePasswordPage'
import { ForgotPasswordPage } from '../pages/public/ForgotPasswordPage'
import { ForgotUsernamePage } from '../pages/public/ForgotUsernamePage'
import { RegisterPage } from '../pages/public/RegisterPage'
import { RegisterWithInvitationPage } from '../pages/public/RegisterWithInvitationPage'
import { ResetPasswordPage } from '../pages/public/ResetPasswordPage'
import { SignInPage } from '../pages/public/SignInPage'

export const routes: RouteObject[] = [
  {
    element: <Root />,
    children: [
      { path: '/signin', element: <SignInPage /> },
      { path: '/register', element: <RegisterPage /> },
      { path: '/forgot-password', element: <ForgotPasswordPage /> },
      { path: '/forgot-username', element: <ForgotUsernamePage /> },
      { path: '/reset-password/:token', element: <ResetPasswordPage /> },
      { path: '/register-with-invitation/:token', element: <RegisterWithInvitationPage /> },
      {
        element: <RequireAuth />,
        children: [
          {
            element: <AppLayout />,
            children: [
              { index: true, element: <Placeholder title="nav.home" /> },
              { path: 'account/password', element: <ChangePasswordPage /> },
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
