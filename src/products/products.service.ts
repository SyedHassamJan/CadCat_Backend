import {
  Injectable,
  NotFoundException,
  BadRequestException,
} from '@nestjs/common';

type MulterFile = { fieldname: string; originalname: string; encoding: string; mimetype: string; size: number; buffer: Buffer; };

import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { CreateProductDto } from './dto/create-product.dto';
import { UpdateProductDto } from './dto/update-product.dto';
import { ProductQueryDto } from './dto/product-query.dto';
import { ProductStatus } from '@prisma/client';

function slugify(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\w\s-]/g, '')
    .replace(/[\s_-]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

@Injectable()
export class ProductsService {
  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
  ) {}

  // ─── Public endpoints ──────────────────────────────────────────────────────

  async findAll(query: ProductQueryDto) {
    const { q, category, tag, format, isFree, sort, page = 1, limit = 24 } = query;
    const skip = (page - 1) * limit;

    const where: any = {
      status: ProductStatus.PUBLISHED,
    };

    if (q) {
      where.OR = [
        { title: { contains: q, mode: 'insensitive' } },
        { description: { contains: q, mode: 'insensitive' } },
      ];
    }

    if (category) {
      where.category = { slug: category };
    }

    if (tag) {
      where.productTags = {
        some: { tag: { slug: tag } },
      };
    }

    if (format) {
      where.fileFormat = { equals: format, mode: 'insensitive' };
    }

    if (isFree !== undefined) {
      where.isFree = isFree;
    }

    let orderBy: any = { createdAt: 'desc' };
    if (sort === 'name') orderBy = { title: 'asc' };
    else if (sort === 'price_asc') orderBy = { price: 'asc' };
    else if (sort === 'price_desc') orderBy = { price: 'desc' };
    else if (sort === 'downloads') orderBy = { downloadCount: 'desc' };

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where,
        orderBy,
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          isFree: true,
          price: true,
          currency: true,
          fileFormat: true,
          cadVersion: true,
          thumbnailKey: true,
          downloadCount: true,
          createdAt: true,
          category: { select: { id: true, name: true, slug: true } },
          productTags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
          // NEVER include fileKey in public responses
        },
      }),
      this.prisma.product.count({ where }),
    ]);

    return {
      data: products,
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findBySlug(slug: string) {
    const product = await this.prisma.product.findFirst({
      where: { slug, status: ProductStatus.PUBLISHED },
      select: {
        id: true,
        title: true,
        slug: true,
        description: true,
        isFree: true,
        price: true,
        currency: true,
        fileFormat: true,
        cadVersion: true,
        fileSizeBytes: true,
        previewImageKey: true,
        thumbnailKey: true,
        downloadCount: true,
        paddlePriceId: true,
        createdAt: true,
        // fileKey is NEVER included in public responses
        category: { select: { id: true, name: true, slug: true } },
        productTags: { select: { tag: { select: { id: true, name: true, slug: true } } } },
      },
    });

    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async search(query: string) {
    return this.findAll({ q: query, page: 1, limit: 24, sort: 'newest' });
  }

  // ─── Admin endpoints ───────────────────────────────────────────────────────

  async findAllAdmin(page = 1, limit = 20) {
    const skip = (page - 1) * limit;
    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take: limit,
        select: {
          id: true,
          title: true,
          slug: true,
          status: true,
          isFree: true,
          price: true,
          currency: true,
          fileFormat: true,
          cadVersion: true,
          fileSizeBytes: true,
          downloadCount: true,
          createdAt: true,
          updatedAt: true,
          category: { select: { id: true, name: true, slug: true } },
        },
      }),
      this.prisma.product.count(),
    ]);

    return { data: products, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOneAdmin(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: {
        category: true,
        productTags: { include: { tag: true } },
      },
    });
    if (!product) throw new NotFoundException('Product not found');
    return product;
  }

  async create(dto: CreateProductDto) {
    const slug = dto.slug || slugify(dto.title);

    // Check slug uniqueness
    const existing = await this.prisma.product.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException(`Slug "${slug}" already exists`);

    const { tagIds, categoryId, ...productData } = dto;

    const product = await this.prisma.product.create({
      data: {
        ...productData,
        slug,
        category: categoryId ? { connect: { id: categoryId } } : undefined,
        productTags: tagIds?.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: {
        category: true,
        productTags: { include: { tag: true } },
      },
    });

    return product;
  }

  async update(id: string, dto: UpdateProductDto) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const { tagIds, categoryId, ...updateData } = dto;

    // If slug is changing, verify uniqueness
    if (updateData.slug && updateData.slug !== product.slug) {
      const existing = await this.prisma.product.findUnique({
        where: { slug: updateData.slug },
      });
      if (existing) throw new BadRequestException(`Slug "${updateData.slug}" already exists`);
    }

    if (tagIds !== undefined) {
      await this.prisma.productTag.deleteMany({ where: { productId: id } });
    }

    const categoryUpdate = categoryId
      ? { connect: { id: categoryId } }
      : categoryId === null || categoryId === ''
      ? { disconnect: true }
      : undefined;

    const updated = await this.prisma.product.update({
      where: { id },
      data: {
        ...updateData,
        category: categoryUpdate,
        productTags: tagIds?.length
          ? { create: tagIds.map((tagId) => ({ tagId })) }
          : undefined,
      },
      include: {
        category: true,
        productTags: { include: { tag: true } },
      },
    });

    return updated;
  }

  async remove(id: string) {
    const product = await this.prisma.product.findUnique({
      where: { id },
      include: { orderItems: { take: 1 } },
    });
    if (!product) throw new NotFoundException('Product not found');

    // If product has orders, archive instead of delete (roadmap rule)
    if (product.orderItems.length > 0) {
      return this.prisma.product.update({
        where: { id },
        data: { status: ProductStatus.ARCHIVED },
      });
    }

    return this.prisma.product.delete({ where: { id } });
  }

  async updateMedia(
    id: string,
    files: {
      cadFile?: MulterFile;
      previewImage?: MulterFile;
    },
  ) {
    const product = await this.prisma.product.findUnique({ where: { id } });
    if (!product) throw new NotFoundException('Product not found');

    const updateData: any = {};

    if (files.cadFile) {
      const result = await this.storage.uploadCadFile(files.cadFile);
      updateData.fileKey = result.key;
      updateData.fileSizeBytes = result.size;
      updateData.fileFormat = files.cadFile.originalname.split('.').pop()?.toLowerCase();
    }

    if (files.previewImage) {
      // Upload watermarked preview
      const preview = await this.storage.uploadPreviewImage(files.previewImage);
      updateData.previewImageKey = preview.key;

      // Also create thumbnail
      const thumb = await this.storage.uploadThumbnail(files.previewImage);
      updateData.thumbnailKey = thumb.key;
    }

    return this.prisma.product.update({
      where: { id },
      data: updateData,
    });
  }

  async getDashboardStats() {
    const [totalProducts, freeProducts, paidProducts, totalOrders, recentOrders] =
      await Promise.all([
        this.prisma.product.count({ where: { status: ProductStatus.PUBLISHED } }),
        this.prisma.product.count({ where: { status: ProductStatus.PUBLISHED, isFree: true } }),
        this.prisma.product.count({ where: { status: ProductStatus.PUBLISHED, isFree: false } }),
        this.prisma.order.count({ where: { status: 'PAID' } }),
        this.prisma.order.aggregate({
          where: {
            status: 'PAID',
            createdAt: { gte: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
          },
          _sum: { totalAmount: true },
          _count: true,
        }),
      ]);

    return {
      totalProducts,
      freeProducts,
      paidProducts,
      totalOrders,
      revenueThisMonth: recentOrders._sum.totalAmount || 0,
      ordersThisMonth: recentOrders._count,
    };
  }
}
