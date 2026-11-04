/**
 * Idempotent seed: roles, every permission code, and the role grants (`npm run seed`).
 * Connects with DATABASE_URL (the tocs_app account is enough: DML on roles, permissions, role_permissions).
 *
 * Grants follow the legacy chineseschool/db/seeds.rb. Additive only: existing roles/grants are never
 * removed, so grants added later by an administrator survive re-seeding. Super User gets no rows (it
 * implicitly holds every code); access.* and auth.invitations.create are granted to no role.
 */
import { PrismaClient } from '@prisma/client';
import { PERMISSION_CODES, PERMISSION_DESCRIPTIONS, PermissionCode, SUPER_USER_ROLE } from '../src/access/permission-codes';

export const ROLE_GRANTS: ReadonlyArray<readonly [string, readonly PermissionCode[]]> = [
  [SUPER_USER_ROLE, []],
  ['Principal', ['home.panel.principal']],
  ['Academic Vice Principal', ['home.panel.academic_vice_principal']],
  [
    'Registration Officer',
    [
      'people.read',
      'people.edit',
      'people.address.create',
      'people.address.edit',
      'families.read',
      'families.create',
      'families.address.edit',
      'families.parent.add',
      'families.child.add',
      'school_years.read',
      'school_years.create',
      'school_years.edit',
      'school_years.book_charges.edit',
      'school_years.auto_class_assignment.toggle',
      'grades.read',
      'school_classes.read',
      'school_classes.create',
      'school_classes.edit',
      'school_classes.toggle_active',
      'home.panel.registration_officer',
    ],
  ],
  ['Accounting Officer', ['home.panel.accounting_officer']],
  ['Activity Officer', ['home.panel.activity_officer']],
  ['Communication Officer', ['home.panel.communication_officer']],
  ['Instruction Officer', ['home.panel.instruction_officer']],
  ['Instructor', ['home.panel.instructor']],
  ['Room Parent', ['home.panel.instructor']],
  [
    'Student Parent',
    [
      'family.self.address.edit',
      'family.self.parent.add',
      'family.self.child.add',
      'person.self.edit',
      'person.self.address.create',
      'person.self.address.edit',
      'home.panel.student_parent',
    ],
  ],
  ['CCCA Staff', []],
  ['PVA', ['home.panel.pva']],
];

export async function seed(prisma: PrismaClient): Promise<void> {
  const permissionIds = new Map<PermissionCode, number>();
  for (const code of PERMISSION_CODES) {
    const description = PERMISSION_DESCRIPTIONS[code];
    const row = await prisma.permission.upsert({ where: { code }, create: { code, description }, update: { description } });
    permissionIds.set(code, row.id);
  }

  for (const [name, codes] of ROLE_GRANTS) {
    // roles.name has no unique constraint in the legacy schema; match the first role with that name.
    const now = new Date();
    const role =
      (await prisma.role.findFirst({ where: { name }, orderBy: { id: 'asc' } })) ??
      (await prisma.role.create({ data: { name, createdAt: now, updatedAt: now } }));
    if (codes.length === 0) continue;
    await prisma.rolePermission.createMany({
      data: codes.map((code) => ({ roleId: role.id, permissionId: permissionIds.get(code) as number })),
      skipDuplicates: true,
    });
  }
}

if (require.main === module) {
  const prisma = new PrismaClient();
  seed(prisma)
    .then(() => console.log('seed: done'))
    .catch((e: unknown) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => void prisma.$disconnect());
}
