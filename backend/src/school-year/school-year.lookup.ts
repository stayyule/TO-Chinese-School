import { Injectable } from '@nestjs/common';
import type { Prisma, SchoolYear } from '@prisma/client';
import { Cents, cents } from '../common/cents';
import { Clock } from '../common/clock';
import { PacificDate, comparePacific, fromDbDate, toDbDate } from '../common/pacific-date';
import { PrismaService } from '../prisma/prisma.service';

export interface SchoolYearRow {
  id: number;
  name: string | null;
  description: string | null;
  startDate: PacificDate | null;
  endDate: PacificDate | null;
  registrationStartDate: PacificDate | null;
  registration75PercentDate: PacificDate | null;
  /** Legacy, unused by the new system. */
  registration50PercentDate: PacificDate | null;
  registrationEndDate: PacificDate | null;
  earlyRegistrationStartDate: PacificDate | null;
  earlyRegistrationEndDate: PacificDate | null;
  refund90PercentDate: PacificDate | null;
  refund75PercentDate: PacificDate | null;
  refund50PercentDate: PacificDate | null;
  /** Legacy, unused by the new system. */
  refund25PercentDate: PacificDate | null;
  refundEndDate: PacificDate | null;
  ageCutoffMonth: number | null;
  previousSchoolYearId: number | null;
  autoClassAssignment: boolean;
  registrationFeeInCents: Cents;
  tuitionInCents: Cents;
  pvaMembershipDueInCents: Cents;
  cccaMembershipDueInCents: Cents;
  earlyRegistrationTuitionInCents: Cents;
  tuitionDiscountForThreeOrMoreChildInCents: Cents;
  tuitionDiscountForPreKInCents: Cents;
  tuitionDiscountForInstructorInCents: Cents;
  parentAndStudentClassFeeInCents: Cents;
  electiveClassFeeInCents: Cents;
  earlyRegistrationParentAndStudentClassFeeInCents: Cents;
}

const date = (d: Date | null): PacificDate | null => (d === null ? null : fromDbDate(d));

function toRow(r: SchoolYear): SchoolYearRow {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    startDate: date(r.startDate),
    endDate: date(r.endDate),
    registrationStartDate: date(r.registrationStartDate),
    registration75PercentDate: date(r.registration75PercentDate),
    registration50PercentDate: date(r.registration50PercentDate),
    registrationEndDate: date(r.registrationEndDate),
    earlyRegistrationStartDate: date(r.earlyRegistrationStartDate),
    earlyRegistrationEndDate: date(r.earlyRegistrationEndDate),
    refund90PercentDate: date(r.refund90PercentDate),
    refund75PercentDate: date(r.refund75PercentDate),
    refund50PercentDate: date(r.refund50PercentDate),
    refund25PercentDate: date(r.refund25PercentDate),
    refundEndDate: date(r.refundEndDate),
    ageCutoffMonth: r.ageCutoffMonth,
    previousSchoolYearId: r.previousSchoolYearId,
    autoClassAssignment: r.autoClassAssignment,
    registrationFeeInCents: cents(r.registrationFeeInCents),
    tuitionInCents: cents(r.tuitionInCents),
    pvaMembershipDueInCents: cents(r.pvaMembershipDueInCents),
    cccaMembershipDueInCents: cents(r.cccaMembershipDueInCents),
    earlyRegistrationTuitionInCents: cents(r.earlyRegistrationTuitionInCents),
    tuitionDiscountForThreeOrMoreChildInCents: cents(r.tuitionDiscountForThreeOrMoreChildInCents),
    tuitionDiscountForPreKInCents: cents(r.tuitionDiscountForPreKInCents),
    tuitionDiscountForInstructorInCents: cents(r.tuitionDiscountForInstructorInCents),
    parentAndStudentClassFeeInCents: cents(r.parentAndStudentClassFeeInCents),
    electiveClassFeeInCents: cents(r.electiveClassFeeInCents),
    earlyRegistrationParentAndStudentClassFeeInCents: cents(r.earlyRegistrationParentAndStudentClassFeeInCents),
  };
}

@Injectable()
export class SchoolYearLookup {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: Clock,
  ) {}

  /**
   * Years whose end_date is today or later, earliest start first. NULL end_date never matches. Pass a transaction
   * client to read inside a caller's transaction (no second connection while it is open).
   */
  async currentAndFuture(db: Prisma.TransactionClient = this.prisma): Promise<SchoolYearRow[]> {
    const rows = await db.schoolYear.findMany({
      where: { endDate: { gte: toDbDate(this.clock.today()) } },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRow);
  }

  async current(db: Prisma.TransactionClient = this.prisma): Promise<SchoolYearRow | null> {
    return (await this.currentAndFuture(db))[0] ?? null;
  }

  async next(): Promise<SchoolYearRow | null> {
    return (await this.currentAndFuture())[1] ?? null;
  }

  /** Latest-ending year that has not yet ended. */
  async newest(): Promise<SchoolYearRow | null> {
    const row = await this.prisma.schoolYear.findFirst({
      where: { endDate: { gte: toDbDate(this.clock.today()) } },
      orderBy: [{ endDate: 'desc' }, { id: 'desc' }],
    });
    return row ? toRow(row) : null;
  }

  /** early_registration_start_date <= today <= registration_end_date (either NULL: not active). */
  async activeForRegistration(): Promise<SchoolYearRow[]> {
    const today = this.clock.today();
    const rows = await this.prisma.schoolYear.findMany({
      where: {
        earlyRegistrationStartDate: { lte: toDbDate(today) },
        registrationEndDate: { gte: toDbDate(today) },
      },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRow);
  }

  /** refund_end_date >= today (NULL: not active). */
  async activeForRefund(): Promise<SchoolYearRow[]> {
    const rows = await this.prisma.schoolYear.findMany({
      where: { refundEndDate: { gte: toDbDate(this.clock.today()) } },
      orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
    });
    return rows.map(toRow);
  }

  hasStarted(y: SchoolYearRow): boolean {
    return y.startDate !== null && comparePacific(this.clock.today(), y.startDate) >= 0;
  }
}
