import { IsBoolean, IsInt, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

/*
 * Shape and type checks only (unknown fields -> 422 through the global ValidationPipe). Required fields, ranges,
 * the type list and name uniqueness are checked by school-class.rules.ts / the service. Every field is optional
 * so PATCH can be partial; create requires the names and type through the rules. maxSize may be omitted but not
 * null; minAge/maxAge/gradeId may be null.
 */
export class SchoolClassInputDto {
  @IsOptional() @IsString() @MaxLength(1024) englishName?: string;
  @IsOptional() @IsString() @MaxLength(1024) chineseName?: string;
  @IsOptional() @IsString() @MaxLength(1024) shortName?: string | null;
  @IsOptional() @IsString() @MaxLength(1024) description?: string | null;
  @IsOptional() @IsString() @MaxLength(1024) location?: string | null;
  @IsOptional() @IsString() @MaxLength(64) schoolClassType?: string;
  @ValidateIf((o: SchoolClassInputDto) => o.maxSize !== undefined) @IsInt() maxSize?: number;
  @IsOptional() @IsInt() minAge?: number | null;
  @IsOptional() @IsInt() maxAge?: number | null;
  @IsOptional() @IsInt() gradeId?: number | null;
}

export class SchoolClassActiveDto {
  @IsInt() schoolYearId!: number;
  @IsBoolean() active!: boolean;
}
