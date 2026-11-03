import { Controller, Get } from '@nestjs/common';
import { RequirePermission } from '../access/permission.decorators';
import { PrismaService } from '../prisma/prisma.service';

export interface GradeView {
  id: number;
  chineseName: string | null;
  englishName: string | null;
  shortName: string | null;
  nextGradeId: number | null;
  jerseyNumberPrefix: string | null;
}

/**
 * Grades in school order: follow next_grade from short_name 'Pre'. A cycle ends the walk; grades not reached
 * (orphans, broken chain, no 'Pre') follow in id order.
 */
export function orderGrades(grades: GradeView[]): GradeView[] {
  const byId = new Map(grades.map((g) => [g.id, g]));
  const seen = new Set<number>();
  const ordered: GradeView[] = [];
  let cursor = grades.find((g) => g.shortName === 'Pre');
  while (cursor !== undefined && !seen.has(cursor.id)) {
    seen.add(cursor.id);
    ordered.push(cursor);
    cursor = cursor.nextGradeId === null ? undefined : byId.get(cursor.nextGradeId);
  }
  for (const g of grades) if (!seen.has(g.id)) ordered.push(g);
  return ordered;
}

@Controller('grades')
export class GradesController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  @RequirePermission('grades.read')
  async list(): Promise<GradeView[]> {
    const rows = await this.prisma.grade.findMany({ orderBy: { id: 'asc' } });
    return orderGrades(
      rows.map((g) => ({
        id: g.id,
        chineseName: g.chineseName,
        englishName: g.englishName,
        shortName: g.shortName,
        nextGradeId: g.nextGrade,
        jerseyNumberPrefix: g.jerseyNumberPrefix,
      })),
    );
  }
}
