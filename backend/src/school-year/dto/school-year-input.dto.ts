import { IsInt, IsOptional, IsString, MaxLength } from 'class-validator';

/*
 * Shape and type checks only (unknown fields -> 422 through the global ValidationPipe). Money fields are integer
 * CENTS (a float or a string is a 422); dates are YYYY-MM-DD strings whose calendar validity, the required
 * fields, ranges and ordering are checked by school-year.rules.ts (field-keyed 422 details). Every field is
 * optional here so PATCH can be partial; create requires them all through the rules.
 * Legacy date columns (registration_50, refund_75, refund_25) and previous_school_year_id are not accepted.
 */
export class SchoolYearInputDto {
  @IsOptional() @IsString() @MaxLength(1024) name?: string;
  @IsOptional() @IsString() @MaxLength(1024) description?: string;
  @IsOptional() @IsInt() ageCutoffMonth?: number;

  @IsOptional() @IsString() @MaxLength(32) startDate?: string;
  @IsOptional() @IsString() @MaxLength(32) endDate?: string;
  @IsOptional() @IsString() @MaxLength(32) earlyRegistrationStartDate?: string;
  @IsOptional() @IsString() @MaxLength(32) earlyRegistrationEndDate?: string;
  @IsOptional() @IsString() @MaxLength(32) registrationStartDate?: string;
  @IsOptional() @IsString() @MaxLength(32) registration75PercentDate?: string;
  @IsOptional() @IsString() @MaxLength(32) registrationEndDate?: string;
  @IsOptional() @IsString() @MaxLength(32) refund90PercentDate?: string;
  @IsOptional() @IsString() @MaxLength(32) refund50PercentDate?: string;
  @IsOptional() @IsString() @MaxLength(32) refundEndDate?: string;

  @IsOptional() @IsInt() registrationFee?: number;
  @IsOptional() @IsInt() earlyRegistrationTuition?: number;
  @IsOptional() @IsInt() tuition?: number;
  @IsOptional() @IsInt() electiveClassFee?: number;
  @IsOptional() @IsInt() tuitionDiscountForThreeOrMoreChild?: number;
  @IsOptional() @IsInt() tuitionDiscountForPreK?: number;
  @IsOptional() @IsInt() tuitionDiscountForInstructor?: number;
  @IsOptional() @IsInt() pvaMembershipDue?: number;
  @IsOptional() @IsInt() cccaMembershipDue?: number;
  @IsOptional() @IsInt() parentAndStudentClassFee?: number;
  @IsOptional() @IsInt() earlyRegistrationParentAndStudentClassFee?: number;
}
