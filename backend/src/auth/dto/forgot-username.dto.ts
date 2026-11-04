import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, Matches, MaxLength } from 'class-validator';
import { SINGLE_EMAIL } from '../../mail/mail.service';

export class ForgotUsernameDto {
  // Format errors are a 422 that does not depend on whether the address is on record.
  @Transform(({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  @Matches(SINGLE_EMAIL, { message: 'email must be a single email address' })
  email!: string;
}
