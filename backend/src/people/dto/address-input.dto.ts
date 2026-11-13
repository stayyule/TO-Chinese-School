import { IsOptional, IsString, MaxLength } from 'class-validator';

/*
 * Shape and type checks only (unknown fields → 422 through the global ValidationPipe). Required fields, formats
 * and lengths are checked by src/people/validation.ts (field-keyed 422 VALIDATION_ERROR details). The generous
 * MaxLength only caps request size.
 */
export class AddressInputDto {
  @IsOptional() @IsString() @MaxLength(1024) street?: string;
  @IsOptional() @IsString() @MaxLength(1024) city?: string;
  @IsOptional() @IsString() @MaxLength(1024) state?: string;
  @IsOptional() @IsString() @MaxLength(1024) zipcode?: string;
  @IsOptional() @IsString() @MaxLength(1024) homePhone?: string;
  @IsOptional() @IsString() @MaxLength(1024) cellPhone?: string;
  @IsOptional() @IsString() @MaxLength(1024) email?: string;
}
