import { IsBoolean, IsOptional, IsString, IsUUID } from 'class-validator';

export class AssignProfileDto {
  /** Profile to group this device under, or null to ungroup. */
  @IsOptional()
  @IsUUID()
  profileId?: string | null;
}

export class UpdateDeviceDto {
  @IsOptional()
  @IsString()
  name?: string;

  @IsOptional()
  @IsBoolean()
  blocked?: boolean;

  @IsOptional()
  @IsUUID()
  profileId?: string | null;
}
