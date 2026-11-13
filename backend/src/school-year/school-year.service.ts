import { Injectable } from '@nestjs/common';
import type { Prisma, SchoolYear } from '@prisma/client';
import { AuditService } from '../audit/audit.service';
import { Clock } from '../common/clock';
import { AppError } from '../common/errors';
import { PacificDate, pacificDate, toDbDate } from '../common/pacific-date';
import { validationProblem, type ValidationErrors } from '../people/validation';
import { PrismaService } from '../prisma/prisma.service';
import { toRow } from './school-year.lookup';
import {
  DATE_FIELDS,
  FEE_FIELDS,
  applyDateEdits,
  validateSchoolYear,
  type DateField,
  type FeeField,
  type SchoolYearInput,
} from './school-year.rules';

const DEFAULT_BOOK_CHARGE_IN_CENTS = 2000;
const notFound = (): AppError => new AppError(404, 'NOT_FOUND', 'School year not found');
const FEE_KEYS = Object.keys(FEE_FIELDS) as FeeField[];

/** API shape: money in integer cents, dates as YYYY-MM-DD. The legacy date columns are not exposed. */
export type SchoolYearView = { id: number; name: string | null; description: string | null; ageCutoffMonth: number | null } & {
  [K in DateField]: PacificDate | null;
} & { [K in FeeField]: number } & { previousSchoolYearId: number | null; autoClassAssignment: boolean };

function toView(r: SchoolYear): SchoolYearView {
  const row = toRow(r);
  const view: Record<string, unknown> = {
    id: row.id,
    name: row.name,
    description: row.description,
    ageCutoffMonth: row.ageCutoffMonth,
  };
  for (const f of DATE_FIELDS) view[f] = row[f];
  for (const f of FEE_KEYS) view[f] = row[FEE_FIELDS[f]];
  view.previousSchoolYearId = row.previousSchoolYearId;
  view.autoClassAssignment = row.autoClassAssignment;
  return view as SchoolYearView;
}

/** The scalar columns of a validated input (dates through toDbDate, fees to their cents columns). */
function columns(input: SchoolYearInput): Prisma.SchoolYearUncheckedUpdateInput {
  const data: Record<string, unknown> = {
    name: input.name?.trim() ?? null,
    description: input.description?.trim() || null,
    ageCutoffMonth: input.ageCutoffMonth ?? null,
  };
  // pacificDate() re-validates and returns the canonical YYYY-MM-DD string, so nothing else reaches the database.
  for (const f of DATE_FIELDS) data[f] = input[f] ? toDbDate(pacificDate(input[f])) : null;
  for (const f of FEE_KEYS) data[FEE_FIELDS[f]] = input[f];
  return data as Prisma.SchoolYearUncheckedUpdateInput;
}

export interface BookChargeView {
  id: number;
  gradeId: number;
  gradeName: string;
  bookChargeInCents: number;
}

const INT4_MAX = 2_147_483_647;

/** Shape-check a PUT book-charges body; field-keyed 422 details like `items.0.bookChargeInCents`. */
function parseBookChargeBody(body: unknown): { id: number; bookChargeInCents: number }[] {
  if (!Array.isArray(body) || body.length === 0) {
    throw validationProblem({ body: 'REQUIRED' }) as AppError;
  }
  const errors: ValidationErrors = {};
  const seen = new Set<number>();
  const items: { id: number; bookChargeInCents: number }[] = [];
  body.forEach((raw: unknown, i) => {
    const o = typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : null;
    if (o === null || Object.keys(o).some((k) => k !== 'id' && k !== 'bookChargeInCents')) {
      errors[`items.${i}`] = 'INVALID';
      return;
    }
    const { id, bookChargeInCents: value } = o;
    if (typeof id !== 'number' || !Number.isInteger(id) || id < 1 || id > INT4_MAX) errors[`items.${i}.id`] = 'INVALID';
    else if (seen.has(id)) errors[`items.${i}.id`] = 'INVALID';
    else seen.add(id);
    if (value === undefined || value === null) errors[`items.${i}.bookChargeInCents`] = 'REQUIRED';
    else if (typeof value !== 'number' || !Number.isInteger(value)) errors[`items.${i}.bookChargeInCents`] = 'INVALID';
    else if (value < 0 || value > INT4_MAX) errors[`items.${i}.bookChargeInCents`] = 'OUT_OF_RANGE';
    if (typeof id === 'number' && typeof value === 'number') items.push({ id, bookChargeInCents: value });
  });
  const problem = validationProblem(errors);
  if (problem) throw problem;
  return items;
}

@Injectable()
export class SchoolYearService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
    private readonly audit: AuditService,
  ) {}

  /** Every year, earliest start first (including years that have ended). */
  async list(): Promise<SchoolYearView[]> {
    const rows = await this.prisma.schoolYear.findMany({ orderBy: [{ startDate: 'asc' }, { id: 'asc' }] });
    return rows.map(toView);
  }

  async get(id: number): Promise<SchoolYearView> {
    const row = await this.prisma.schoolYear.findUnique({ where: { id } });
    if (!row) throw notFound();
    return toView(row);
  }

  /**
   * One transaction (serialized by an advisory lock so previous_school_year_id links cannot interleave): insert
   * the year with previous = latest year ending on or before the new start, an active flag for every class, a
   * 2000-cent book charge for every grade, and the audit event.
   */
  async create(input: SchoolYearInput, actorUserId?: number): Promise<SchoolYearView> {
    const problem = validationProblem(validateSchoolYear(input));
    if (problem) throw problem;
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext('school_year_create'))`;
      const previous = await tx.schoolYear.findFirst({
        where: { endDate: { lte: toDbDate(input.startDate as PacificDate) } },
        orderBy: [{ endDate: 'desc' }, { id: 'desc' }],
        select: { id: true },
      });
      const created = await tx.schoolYear.create({
        data: { ...(columns(input) as Prisma.SchoolYearUncheckedCreateInput), previousSchoolYearId: previous?.id ?? null, createdAt: now, updatedAt: now },
      });
      const classes = await tx.schoolClass.findMany({ select: { id: true } });
      await tx.schoolClassActiveFlag.createMany({
        data: classes.map((c) => ({ schoolClassId: c.id, schoolYearId: created.id, active: true, createdAt: now, updatedAt: now })),
      });
      const grades = await tx.grade.findMany({ select: { id: true } });
      await tx.bookCharge.createMany({
        data: grades.map((g) => ({ gradeId: g.id, schoolYearId: created.id, bookChargeInCents: DEFAULT_BOOK_CHARGE_IN_CENTS, createdAt: now, updatedAt: now })),
      });
      await this.audit.record({ action: 'school_year.created', actorUserId, targetType: 'school_year', targetId: created.id, meta: { id: created.id } }, tx);
      return toView(created);
    });
  }

  /**
   * Partial update: the request is overlaid on the stored year (dates through applyDateEdits, so a date that has
   * passed is frozen; fees and the other fields always apply) and the merged result is validated. Never touches
   * previous_school_year_id or the auto-class-assignment flag.
   */
  async update(id: number, input: SchoolYearInput, actorUserId?: number): Promise<SchoolYearView> {
    const existing = await this.prisma.schoolYear.findUnique({ where: { id } });
    if (!existing) throw notFound();
    const before = toView(existing) as unknown as Record<string, unknown>;
    const merged: Record<string, unknown> = {};
    const asked = input as Record<string, unknown>;
    for (const k of ['name', 'description', 'ageCutoffMonth', ...FEE_KEYS]) merged[k] = asked[k] !== undefined ? asked[k] : before[k];
    Object.assign(merged, applyDateEdits(before as Partial<Record<DateField, PacificDate | null>>, input, this.clock.today()));
    const mergedInput = merged as SchoolYearInput;
    const problem = validationProblem(validateSchoolYear(mergedInput));
    if (problem) throw problem;
    const changed = Object.keys(merged)
      .filter((k) => (merged[k] ?? null) !== (before[k] ?? null))
      .sort();
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.schoolYear.update({ where: { id }, data: { ...columns(mergedInput), updatedAt: now } });
      await this.audit.record({ action: 'school_year.updated', actorUserId, targetType: 'school_year', targetId: id, meta: { id, changed } }, tx);
      return toView(updated);
    });
  }

  /** A year's book charges ordered by grade_id (old BookCharge.find_all_for). */
  async listBookCharges(schoolYearId: number, db: Prisma.TransactionClient = this.prisma): Promise<BookChargeView[]> {
    if (!(await db.schoolYear.findUnique({ where: { id: schoolYearId }, select: { id: true } }))) throw notFound();
    const rows = await db.bookCharge.findMany({ where: { schoolYearId }, include: { grade: true }, orderBy: [{ gradeId: 'asc' }, { id: 'asc' }] });
    return rows.map((r) => ({
      id: r.id,
      gradeId: r.gradeId,
      gradeName: `${r.grade.chineseName ?? ''}${r.grade.englishName ? `(${r.grade.englishName})` : ''}`,
      bookChargeInCents: r.bookChargeInCents,
    }));
  }

  /**
   * All-or-nothing: the body must be a non-empty array of {id, bookChargeInCents} (integer cents, 0..int4 max,
   * no duplicate ids, no other fields) and every id must be a charge of THIS year (INVALID_BOOK_CHARGE, 422),
   * otherwise nothing is written. Only rows whose value differs are updated.
   */
  async updateBookCharges(schoolYearId: number, body: unknown, actorUserId?: number): Promise<BookChargeView[]> {
    const items = parseBookChargeBody(body);
    const now = this.clock.now();
    return this.prisma.$transaction(async (tx) => {
      const current = await this.listBookCharges(schoolYearId, tx);
      const byId = new Map(current.map((c) => [c.id, c]));
      if (items.some((i) => !byId.has(i.id))) {
        throw new AppError(422, 'INVALID_BOOK_CHARGE', 'Every book charge must belong to this school year');
      }
      const changes = items.filter((i) => byId.get(i.id)?.bookChargeInCents !== i.bookChargeInCents);
      for (const c of changes) {
        await tx.bookCharge.update({ where: { id: c.id }, data: { bookChargeInCents: c.bookChargeInCents, updatedAt: now } });
      }
      await this.audit.record(
        { action: 'school_year.book_charges_updated', actorUserId, targetType: 'school_year', targetId: schoolYearId, meta: { schoolYearId, changed: changes.length } },
        tx,
      );
      return this.listBookCharges(schoolYearId, tx);
    });
  }

  /** Atomic flip (safe under concurrent calls); returns the new value. */
  async toggleAutoClassAssignment(id: number): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<{ auto_class_assignment: boolean }[]>`
      UPDATE school_years SET auto_class_assignment = NOT auto_class_assignment, updated_at = ${this.clock.now()}
      WHERE id = ${id} RETURNING auto_class_assignment`;
    if (rows.length === 0) throw notFound();
    return rows[0].auto_class_assignment;
  }
}
