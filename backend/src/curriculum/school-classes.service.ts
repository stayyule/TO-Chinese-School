import { Injectable } from '@nestjs/common';
import type { Prisma, SchoolClass } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { validationProblem } from '../people/validation';
import { PrismaService } from '../prisma/prisma.service';
import { SchoolYearLookup } from '../school-year/school-year.lookup';
import { DEFAULT_MAX_SIZE, normalizeSchoolClass, validateSchoolClass, type SchoolClassInput } from './school-class.rules';

export interface SchoolClassView {
  id: number;
  englishName: string | null;
  chineseName: string | null;
  shortName: string | null;
  description: string | null;
  location: string | null;
  schoolClassType: string | null;
  maxSize: number | null;
  minAge: number | null;
  maxAge: number | null;
  gradeId: number | null;
}
export type SchoolClassListItem = SchoolClassView & { activeCurrent: boolean; activeNext: boolean };

const notFound = (what: string): AppError => new AppError(404, 'NOT_FOUND', `${what} not found`);

const toView = (c: SchoolClass): SchoolClassView => ({
  id: c.id,
  englishName: c.englishName,
  chineseName: c.chineseName,
  shortName: c.shortName,
  description: c.description,
  location: c.location,
  schoolClassType: c.schoolClassType,
  maxSize: c.maxSize,
  minAge: c.minAge,
  maxAge: c.maxAge,
  gradeId: c.gradeId,
});

@Injectable()
export class SchoolClassesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
    private readonly lookup: SchoolYearLookup,
  ) {}

  /** Every class sorted by English name; activeCurrent/activeNext are false when that year does not exist or has no flag row. */
  async list(): Promise<SchoolClassListItem[]> {
    const years = await this.lookup.currentAndFuture();
    const current = years[0]?.id;
    const next = years[1]?.id;
    const classes = await this.prisma.schoolClass.findMany({ orderBy: [{ englishName: 'asc' }, { id: 'asc' }] });
    const yearIds = years.slice(0, 2).map((y) => y.id);
    const flags = yearIds.length === 0 ? [] : await this.prisma.schoolClassActiveFlag.findMany({ where: { schoolYearId: { in: yearIds } } });
    const active = (classId: number, yearId: number | undefined): boolean =>
      yearId !== undefined && flags.some((f) => f.schoolClassId === classId && f.schoolYearId === yearId && f.active);
    return classes.map((c) => ({ ...toView(c), activeCurrent: active(c.id, current), activeNext: active(c.id, next) }));
  }

  /** One transaction: name lock, uniqueness, insert, and an active=true flag for every current-and-future year. */
  async create(input: SchoolClassInput, actorUserId?: number): Promise<SchoolClassView> {
    const merged: SchoolClassInput = { ...input, maxSize: input.maxSize === undefined ? DEFAULT_MAX_SIZE : input.maxSize };
    const problem = validationProblem(validateSchoolClass(merged));
    if (problem) throw problem;
    const data = normalizeSchoolClass(merged);
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await this.lockNames(tx);
      await this.checkGrade(tx, data.gradeId);
      await this.checkNames(tx, data.englishName, data.chineseName);
      const created = await tx.schoolClass.create({ data: { ...data, createdAt: now, updatedAt: now } });
      const years = await this.lookup.currentAndFuture(tx);
      await tx.schoolClassActiveFlag.createMany({
        data: years.map((y) => ({ schoolClassId: created.id, schoolYearId: y.id, active: true, createdAt: now, updatedAt: now })),
      });
      await this.audit.record({ action: 'school_class.created', actorUserId, targetType: 'school_class', targetId: created.id, meta: { id: created.id } }, tx);
      return toView(created);
    });
  }

  /** Partial update: the request is overlaid on the stored class and the merged result validated. */
  async update(id: number, input: SchoolClassInput, actorUserId?: number): Promise<SchoolClassView> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await this.lockNames(tx);
      const existing = await tx.schoolClass.findUnique({ where: { id } });
      if (!existing) throw notFound('School class');
      const merged: Record<string, unknown> = { ...toView(existing) };
      delete merged.id;
      for (const [k, v] of Object.entries(input)) if (v !== undefined) merged[k] = v;
      const problem = validationProblem(validateSchoolClass(merged as SchoolClassInput));
      if (problem) throw problem;
      const data = normalizeSchoolClass(merged as SchoolClassInput);
      await this.checkGrade(tx, data.gradeId);
      await this.checkNames(tx, data.englishName, data.chineseName, id);
      const updated = await tx.schoolClass.update({ where: { id }, data: { ...data, updatedAt: now } });
      await this.audit.record({ action: 'school_class.updated', actorUserId, targetType: 'school_class', targetId: id, meta: { id } }, tx);
      return toView(updated);
    });
  }

  /** Idempotent upsert of the per-year flag, serialized per (class, year) by an advisory lock (the table has no unique key). */
  async setActive(
    schoolClassId: number,
    schoolYearId: number,
    active: boolean,
    actorUserId?: number,
  ): Promise<{ schoolClassId: number; schoolYearId: number; active: boolean }> {
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      if (!(await tx.schoolClass.findUnique({ where: { id: schoolClassId }, select: { id: true } }))) throw notFound('School class');
      if (!(await tx.schoolYear.findUnique({ where: { id: schoolYearId }, select: { id: true } }))) throw notFound('School year');
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${schoolClassId}::int, ${schoolYearId}::int)`;
      const updated = await tx.schoolClassActiveFlag.updateMany({ where: { schoolClassId, schoolYearId }, data: { active, updatedAt: now } });
      if (updated.count === 0) {
        await tx.schoolClassActiveFlag.create({ data: { schoolClassId, schoolYearId, active, createdAt: now, updatedAt: now } });
      }
      await this.audit.record(
        { action: 'school_class.active_changed', actorUserId, targetType: 'school_class', targetId: schoolClassId, meta: { schoolClassId, schoolYearId, active } },
        tx,
      );
      return { schoolClassId, schoolYearId, active };
    });
  }

  private async lockNames(tx: Prisma.TransactionClient): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('school_class_names'))`;
  }

  private async checkGrade(tx: Prisma.TransactionClient, gradeId: number | null): Promise<void> {
    if (gradeId === null) return;
    if (!(await tx.grade.findUnique({ where: { id: gradeId }, select: { id: true } }))) {
      throw validationProblem({ gradeId: 'INVALID' }) as AppError;
    }
  }

  /** Old model: English and Chinese names each unique across classes (exact match, after trimming). */
  private async checkNames(tx: Prisma.TransactionClient, englishName: string, chineseName: string, selfId?: number): Promise<void> {
    const clash = await tx.schoolClass.findFirst({
      where: { OR: [{ englishName }, { chineseName }], ...(selfId === undefined ? {} : { id: { not: selfId } }) },
      select: { id: true },
    });
    if (clash) throw new AppError(409, 'NAME_TAKEN', 'A class with that English or Chinese name already exists');
  }
}
