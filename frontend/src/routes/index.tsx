import type { ReactNode } from 'react'
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
import { BookChargesPage } from '../pages/admin/BookChargesPage'
import { InvitePage } from '../pages/admin/InvitePage'
import { RoleDetailPage } from '../pages/admin/RoleDetailPage'
import { RolesPage } from '../pages/admin/RolesPage'
import { SchoolClassEditPage, SchoolClassNewPage } from '../pages/admin/SchoolClassFormPage'
import { SchoolClassesPage } from '../pages/admin/SchoolClassesPage'
import { SchoolYearEditPage, SchoolYearNewPage } from '../pages/admin/SchoolYearFormPage'
import { SchoolYearsPage } from '../pages/admin/SchoolYearsPage'
import { FamilyPage } from '../pages/registration/FamilyPage'
import { NewFamilyPage } from '../pages/registration/NewFamilyPage'
import { PeoplePage } from '../pages/registration/PeoplePage'
import { PersonPage } from '../pages/registration/PersonPage'

const guard = (code: string, page: ReactNode) => <RequireRoutePermission code={code}>{page}</RequireRoutePermission>

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
              { path: 'registration/people', element: guard('people.read', <PeoplePage />) },
              { path: 'registration/people/:personId', element: guard('people.read', <PersonPage />) },
              { path: 'registration/families/new', element: guard('families.create', <NewFamilyPage />) },
              { path: 'registration/families/:familyId', element: guard('families.read', <FamilyPage />) },
              { path: 'registration/*', element: <NotFound /> },
              { path: 'accounting/*', element: <Placeholder title="nav.accounting" /> },
              { path: 'admin/school-years', element: guard('school_years.read', <SchoolYearsPage />) },
              { path: 'admin/school-years/new', element: guard('school_years.create', <SchoolYearNewPage />) },
              { path: 'admin/school-years/:yearId/edit', element: guard('school_years.edit', <SchoolYearEditPage />) },
              { path: 'admin/school-years/:yearId/book-charges', element: guard('school_years.read', <BookChargesPage />) },
              { path: 'admin/school-classes', element: guard('school_classes.read', <SchoolClassesPage />) },
              { path: 'admin/school-classes/new', element: guard('school_classes.create', <SchoolClassNewPage />) },
              { path: 'admin/school-classes/:classId/edit', element: guard('school_classes.edit', <SchoolClassEditPage />) },
              { path: 'admin/roles', element: guard('access.roles.read', <RolesPage />) },
              { path: 'admin/roles/:roleId', element: guard('access.roles.read', <RoleDetailPage />) },
              { path: 'admin/invitations', element: guard('auth.invitations.create', <InvitePage />) },
              { path: 'admin/*', element: <NotFound /> },
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
