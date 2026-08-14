import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Min,
  MaxLength,
} from 'class-validator';

export class CreateProfileDto {
  @IsString()
  @MaxLength(120)
  name: string;

  @IsOptional()
  @IsIn(['child', 'teen', 'adult', 'guest'])
  kind?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  blockedCategories?: string[];

  @IsOptional()
  @IsBoolean()
  safeSearchEnforced?: boolean;

  @IsOptional()
  @IsBoolean()
  youtubeRestricted?: boolean;

  @IsOptional()
  @IsBoolean()
  blockDnsBypass?: boolean;

  @IsOptional()
  @IsInt()
  @Min(0)
  dailyTimeLimitMinutes?: number | null;
}

export class UpdateProfileDto extends CreateProfileDto {
  @IsOptional()
  @IsString()
  declare name: string;
}

export class PauseProfileDto {
  @IsBoolean()
  paused: boolean;

  @IsOptional()
  @IsIn(['manual', 'bedtime', 'quota_exceeded'])
  reason?: string;
}
