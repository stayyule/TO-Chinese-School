import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { Clock } from '../common/clock';
import { PrismaService } from '../prisma/prisma.service';
import { SchoolYearLookup } from '../school-year/school-year.lookup';

export const INSTRUCTOR_ROLE = 'Instructor';
export const ROOM_PARENT_ROLE = 'Room Parent';

/** instructor_assignments.role -> derived user role (old User#adjust_instructor_roles); others derive nothing. */
const DERIVED_ROLE: ReadonlyMap<string, string> = new Map([
  ['Primary Instructor', INSTRUCTOR_ROLE],
  ['Secondary Instructor', INSTRUCTOR_ROLE],
  ['Room Parent', ROOM_PARENT_ROLE],
]);

@Injectable()
export class RoleDerivationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schoolYears: SchoolYearLookup,
    private readonly clock: Clock,
  ) {}

  /**
   * Removes the user's Instructor/Room Parent rows (all duplicates) and re-adds exactly one row per role derived
   * from the person's instructor assignments in the current school year (none when there is no current year).
   * Runs in `tx` when given, otherwise in its own transaction; a per-user advisory lock serializes concurrent calls.
   */
  async adjust(userId: number, tx?: Prisma.TransactionClient): Promise<void> {
    if (tx) return this.adjustIn(tx, userId);
    await this.prisma.$transaction((t) => this.adjustIn(t, userId));
  }

  private async adjustIn(tx: Prisma.TransactionClient, userId: number): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`role_derivation:${userId}`}))`;
    const user = await tx.user.findUnique({ where: { id: userId }, select: { personId: true } });
    if (!user) return;

    const roles = await tx.role.findMany({
      where: { name: { in: [INSTRUCTOR_ROLE, ROOM_PARENT_ROLE] } },
      select: { id: true, name: true },
      orderBy: { id: 'asc' },
    });
    const roleIdByName = new Map<string, number>();
    for (const r of roles) if (r.name && !roleIdByName.has(r.name)) roleIdByName.set(r.name, r.id);
    if (roles.length > 0) {
      await tx.roleUser.deleteMany({ where: { userId, roleId: { in: roles.map((r) => r.id) } } });
    }

    const year = await this.schoolYears.current(tx);
    if (!year || user.personId === null) return;
    const assignments = await tx.instructorAssignment.findMany({
      where: { instructorId: user.personId, schoolYearId: year.id },
      select: { role: true },
    });
    const wanted = new Set(assignments.map((a) => (a.role ? DERIVED_ROLE.get(a.role) : undefined)).filter((n) => n !== undefined));
    const now = this.clock.now();
    for (const name of wanted) {
      const roleId = roleIdByName.get(name);
      if (roleId !== undefined) await tx.roleUser.create({ data: { roleId, userId, createdAt: now, updatedAt: now } });
    }
  }
}
