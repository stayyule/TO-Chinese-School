import { Test } from '@nestjs/testing';
import { Clock, FixedClock } from '../src/common/clock';
import { ClockModule } from '../src/common/clock.module';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { SchoolYearLookup } from '../src/school-year/school-year.lookup';
import { SchoolYearModule } from '../src/school-year/school-year.module';
import { resetDatabase } from './helpers/db';

describe('SchoolYearModule DI', () => {
  afterAll(async () => {
    await resetDatabase();
  });

  it('injects the shared (overridable) Clock into SchoolYearLookup', async () => {
    await resetDatabase();
    const fixed = new FixedClock(new Date('2026-06-16T20:00:00Z'));
    const moduleRef = await Test.createTestingModule({
      imports: [PrismaModule, ClockModule, SchoolYearModule],
    })
      .overrideProvider(Clock)
      .useValue(fixed)
      .compile();
    await moduleRef.init();
    try {
      const prisma = moduleRef.get(PrismaService);
      await prisma.schoolYear.create({
        data: { name: 'A', startDate: new Date('2025-09-01T00:00:00Z'), endDate: new Date('2026-06-15T00:00:00Z') },
      });
      await prisma.schoolYear.create({
        data: { name: 'B', startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2027-06-15T00:00:00Z') },
      });
      const lookup = moduleRef.get(SchoolYearLookup);
      expect((await lookup.current())?.name).toBe('B');
      fixed.set(new Date('2026-06-15T20:00:00Z'));
      expect((await lookup.current())?.name).toBe('A');
    } finally {
      await moduleRef.close();
    }
  });
});
