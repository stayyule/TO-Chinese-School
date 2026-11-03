import { Type } from 'class-transformer';
import { IsDefined, IsNumber, IsObject, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';
import { AddressInputDto } from './address-input.dto';

/** Shape/type checks only; the rules live in src/people/validation.ts. */
export class PersonInputDto {
  @IsOptional() @IsString() @MaxLength(1024) englishFirstName?: string;
  @IsOptional() @IsString() @MaxLength(1024) englishLastName?: string;
  @IsOptional() @IsString() @MaxLength(1024) chineseName?: string;
  @IsOptional() @IsString() @MaxLength(1024) gender?: string;
  @IsOptional() @IsString() @MaxLength(1024) nativeLanguage?: string;
  // Non-integers reach the validator, which reports INVALID in the shared details shape.
  @IsOptional() @IsNumber() birthYear?: number;
  @IsOptional() @IsNumber() birthMonth?: number;
}

export class CreateFamilyDto {
  @IsDefined() @IsObject() @ValidateNested() @Type(() => AddressInputDto) address!: AddressInputDto;
  @IsDefined() @IsObject() @ValidateNested() @Type(() => PersonInputDto) parentOne!: PersonInputDto;
}
