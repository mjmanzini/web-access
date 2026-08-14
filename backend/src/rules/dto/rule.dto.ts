import { IsBoolean, IsIn, IsOptional, IsString, IsUUID } from 'class-validator';
import { RuleAction, RuleScope, RuleType } from '../../entities/rule.entity';

export class CreateRuleDto {
  @IsIn(['domain', 'category'])
  type: RuleType;

  /** Domain (e.g. "tiktok.com") or category slug (e.g. "gaming"). */
  @IsString()
  value: string;

  @IsOptional()
  @IsIn(['block', 'allow'])
  action?: RuleAction;

  @IsIn(['global', 'profile', 'device'])
  scope: RuleScope;

  @IsOptional()
  @IsUUID()
  profileId?: string;

  @IsOptional()
  @IsUUID()
  deviceId?: string;
}

export class UpdateRuleDto {
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @IsOptional()
  @IsIn(['block', 'allow'])
  action?: RuleAction;
}
