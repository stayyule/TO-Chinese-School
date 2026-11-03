import { createBrowserRouter, createMemoryRouter, Navigate, type RouteObject } from 'react-router-dom'
import { AppLayout } from '../layout/AppLayout'
import { NotFound } from '../pages/NotFound'
import { Placeholder } from '../pages/Placeholder'
import { RequireAuth, Root } from './guards'
import { RequireRoutePermission } from './RequireRoutePermission'
import { HomePage } from '../pages/home/HomePage'
import { AddChildPage } from '../pages/parent/AddChildPage'
import { AddParentPage } from '../pages/parent/AddParentPage'
import { EditAddressPage } from '../pages/parent/EditAddressPage'
import { EditPersonPage } from '../pages/parent/EditPersonPage'
import { MyFamilyPage } from '../pages/parent/MyFamilyPage'
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
              { index: true, element: <HomePage /> },
              { path: 'account/password', element: <ChangePasswordPage /> },
              { path: 'parent', element: <Navigate to="/parent/family" replace /> },
              { path: 'parent/family', element: <MyFamilyPage /> },
              { path: 'parent/families/:familyId/address', element: <RequireRoutePermission code="family.self.address.edit"><EditAddressPage /></RequireRoutePermission> },
              { path: 'parent/families/:familyId/parents/new', element: <RequireRoutePermission code="family.self.parent.add"><AddParentPage /></RequireRoutePermission> },
              { path: 'parent/families/:familyId/children/new', element: <RequireRoutePermission code="family.self.child.add"><AddChildPage /></RequireRoutePermission> },
              { path: 'parent/people/:personId/edit', element: <RequireRoutePermission code="person.self.edit"><EditPersonPage /></RequireRoutePermission> },
              { path: 'parent/*', element: <NotFound /> },
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
