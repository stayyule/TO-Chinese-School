import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ResetPasswordDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  token!: string;

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
