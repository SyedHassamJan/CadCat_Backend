import { IsOptional, IsString, IsEnum, IsBoolean } from 'class-validator';
import { Transform, Type } from 'class-transformer';
import { ProductStatus } from '@prisma/client';

export class ProductQueryDto {
  @IsOptional()
  @IsString()
  q?: string;                // full-text search

  @IsOptional()
  @IsString()
  category?: string;         // category slug

  @IsOptional()
  @IsString()
  tag?: string;              // tag slug

  @IsOptional()
  @IsString()
  format?: string;           // dwg, dxf, skp

  @IsOptional()
  @Transform(({ value }) => value === 'true')
  @IsBoolean()
  isFree?: boolean;

  @IsOptional()
  @IsEnum(['newest', 'name', 'price_asc', 'price_desc', 'downloads'])
  sort?: string = 'newest';

  @IsOptional()
  @Type(() => Number)
  page?: number = 1;

  @IsOptional()
  @Type(() => Number)
  limit?: number = 24;
}
