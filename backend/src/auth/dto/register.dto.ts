import { Type } from 'class-transformer';
import { IsDefined, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/*
 * Shape and type checks only (unknown fields → 422 through the global ValidationPipe). Required fields, formats
 * and lengths are checked by src/people/validation.ts, which reports field-keyed 422 VALIDATION_ERROR details.
 * The generous MaxLength bounds only cap request size.
 */

export class RegisterAddressDto {
  @IsOptional() @IsString() @MaxLength(1024) street?: string;
  @IsOptional() @IsString() @MaxLength(1024) city?: string;
  @IsOptional() @IsString() @MaxLength(1024) state?: string;
  @IsOptional() @IsString() @MaxLength(1024) zipcode?: string;
  @IsOptional() @IsString() @MaxLength(1024) homePhone?: string;
  @IsOptional() @IsString() @MaxLength(1024) cellPhone?: string;
  @IsOptional() @IsString() @MaxLength(1024) email?: string;
}

export class RegisterParentDto {
  @IsOptional() @IsString() @MaxLength(1024) englishFirstName?: string;
  @IsOptional() @IsString() @MaxLength(1024) englishLastName?: string;
  @IsOptional() @IsString() @MaxLength(1024) chineseName?: string;
  @IsOptional() @IsString() @MaxLength(1024) gender?: string;
  @IsOptional() @IsString() @MaxLength(1024) nativeLanguage?: string;
}

export class RegisterDto {
  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RegisterAddressDto)
  address!: RegisterAddressDto;

  @IsDefined()
  @IsObject()
  @ValidateNested()
  @Type(() => RegisterParentDto)
  parentOne!: RegisterParentDto;

  // Trimmed by the service; blank after trimming → 422 VALIDATION_ERROR.
  @IsString()
  @MaxLength(255)
  username!: string;

  // Length policy is enforced by PasswordService (422 PASSWORD_TOO_SHORT), not here.
  @IsString()
  @MaxLength(1024)
  password!: string;

  @IsString()
  @MaxLength(1024)
  passwordConfirmation!: string;
}
