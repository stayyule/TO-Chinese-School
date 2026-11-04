import { IsString, MaxLength } from 'class-validator';

export class ChangePasswordDto {
  @IsString()
  @MaxLength(1024)
  currentPassword!: string;

  // Length policy is enforced by PasswordService (422 PASSWORD_TOO_SHORT), not here.
  @IsString()
  @MaxLength(1024)
  newPassword!: string;

  @IsString()
  @MaxLength(1024)
  newPasswordConfirmation!: string;
}
