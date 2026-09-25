import { IsIn, IsString } from 'class-validator';
export class CreateSiteAuthorizationDto { @IsString() collectorUserId!: string; @IsIn(['LOCATION','PHOTO','LOCATION_AND_PHOTO']) scope!: string; @IsString() reason!: string; @IsString() expiresAt!: string; }
