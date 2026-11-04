import { IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class CreateInvitationDto {
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  personId!: number;

  // Optional here so that missing, empty and blank all answer 422 EMAIL_REQUIRED (checked by the service).
  @IsOptional()
  @IsString()
  @MaxLength(254)
  emailDestination?: string;
}
