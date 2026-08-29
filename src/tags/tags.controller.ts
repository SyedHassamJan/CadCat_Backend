import { Controller, Get, Post, Delete, Body, Param, Query, UseGuards } from '@nestjs/common';
import { TagsService } from './tags.service';
import { CreateTagDto } from './dto/create-tag.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('tags')
export class TagsController {
  constructor(private readonly tagsService: TagsService) {}

  @Get()
  findAll() { return this.tagsService.findAll(); }

  @Get(':slug/products')
  getTagProducts(@Param('slug') slug: string, @Query('page') page?: number) {
    return this.tagsService.getProducts(slug, page);
  }

  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() dto: CreateTagDto) { return this.tagsService.create(dto); }

  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  remove(@Param('id') id: string) { return this.tagsService.remove(id); }
}
