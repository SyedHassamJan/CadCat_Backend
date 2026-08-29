import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
  UseInterceptors,
  UploadedFiles,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ProductsService } from './products.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { StorageService } from '../storage/storage.service';
import { Response } from 'express';
import { Res } from '@nestjs/common';

@Controller('products')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly storageService: StorageService,
  ) {}

  // ─── Public Routes ─────────────────────────────────────────────────────────

  /** GET /api/products/media/* — stream preview and thumbnail images directly from R2 */
  @Get('media/*')
  async getMedia(@Param() params: any, @Res() res: Response) {
    const key = params['0'] || Object.values(params).join('/');
    try {
      const object = await this.storageService.getObjectStream('public', key);
      res.setHeader('Content-Type', object.ContentType || 'image/jpeg');
      res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
      (object.Body as any).pipe(res);
    } catch (e) {
      res.status(404).send('Image not found');
    }
  }

  /** GET /api/products — paginated, filterable product listing */
  @Get()
  findAll(@Query() query: ProductQueryDto) {
    return this.productsService.findAll(query);
  }

  /** GET /api/products/search?q=... — full text search */
  @Get('search')
  search(@Query('q') q: string) {
    return this.productsService.findAll({ q, page: 1, limit: 24, sort: 'newest' });
  }

  /** GET /api/products/:slug — product detail by slug */
  @Get(':slug')
  findOne(@Param('slug') slug: string) {
    return this.productsService.findBySlug(slug);
  }

  // ─── Admin Routes ──────────────────────────────────────────────────────────

  /** GET /api/admin/products — full list with all fields for admin */
  @UseGuards(JwtAuthGuard)
  @Get('admin/list')
  findAllAdmin(@Query('page') page?: number, @Query('limit') limit?: number) {
    return this.productsService.findAllAdmin(page, limit);
  }

  /** GET /api/admin/products/:id — single product for editing */
  @UseGuards(JwtAuthGuard)
  @Get('admin/:id')
  findOneAdmin(@Param('id') id: string) {
    return this.productsService.findOneAdmin(id);
  }

  /** GET /api/admin/dashboard — stats */
  @UseGuards(JwtAuthGuard)
  @Get('admin/dashboard/stats')
  getDashboardStats() {
    return this.productsService.getDashboardStats();
  }

  /** POST /api/products — create a new product (admin only) */
  @UseGuards(JwtAuthGuard)
  @Post()
  create(@Body() createProductDto: CreateProductDto) {
    return this.productsService.create(createProductDto);
  }

  /** PATCH /api/products/:id — update product (admin only) */
  @UseGuards(JwtAuthGuard)
  @Patch(':id')
  update(@Param('id') id: string, @Body() updateProductDto: UpdateProductDto) {
    return this.productsService.update(id, updateProductDto);
  }

  /** DELETE /api/products/:id — delete or archive (admin only) */
  @UseGuards(JwtAuthGuard)
  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  remove(@Param('id') id: string) {
    return this.productsService.remove(id);
  }

  /**
   * POST /api/products/:id/media — upload CAD file + preview image (admin only)
   * Files are multipart/form-data: cadFile and/or previewImage
   */
  @UseGuards(JwtAuthGuard)
  @Post(':id/media')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'cadFile', maxCount: 1 },
      { name: 'previewImage', maxCount: 1 },
    ], {
      limits: { fileSize: 200 * 1024 * 1024 }, // 200MB
      storage: undefined, // use memory storage
    }),
  )
  uploadMedia(
    @Param('id') id: string,
    @UploadedFiles() files: { cadFile?: any[]; previewImage?: any[] },
  ) {
    return this.productsService.updateMedia(id, {
      cadFile: files.cadFile?.[0],
      previewImage: files.previewImage?.[0],
    });
  }
}
