import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class RegisterWithInvitationDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

  // Validated after trimming (blank -> 422); the service trims the value it receives as well.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  username!: string;

  // Length policy is enforced by PasswordService (422 PASSWORD_TOO_SHORT), not here.
  @IsString()
  @MaxLength(1024)
  password!: string;

  @IsString()
  @MaxLength(1024)
  passwordConfirmation!: string;

  // An empty or malformed number is a 422 PHONE_MISMATCH (and counts as a failed attempt).
  @IsString()
  @MaxLength(64)
  phoneNumber!: string;
}
