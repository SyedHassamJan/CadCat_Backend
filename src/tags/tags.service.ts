import { Injectable, NotFoundException, BadRequestException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateTagDto } from './dto/create-tag.dto';

function slugify(text: string): string {
  return text.toLowerCase().replace(/[^\w\s-]/g, '').replace(/[\s_-]+/g, '-').replace(/^-+|-+$/g, '');
}

@Injectable()
export class TagsService {
  constructor(private prisma: PrismaService) {}

  findAll() {
    return this.prisma.tag.findMany({
      orderBy: { name: 'asc' },
      include: { _count: { select: { productTags: true } } },
    });
  }

  async findBySlug(slug: string) {
    const tag = await this.prisma.tag.findUnique({ where: { slug } });
    if (!tag) throw new NotFoundException('Tag not found');
    return tag;
  }

  async getProducts(slug: string, page = 1, limit = 24) {
    const tag = await this.findBySlug(slug);
    const skip = (page - 1) * limit;

    const [products, total] = await Promise.all([
      this.prisma.product.findMany({
        where: { productTags: { some: { tagId: tag.id } }, status: 'PUBLISHED' },
        skip, take: limit, orderBy: { createdAt: 'desc' },
        select: {
          id: true, title: true, slug: true, isFree: true, price: true,
          currency: true, fileFormat: true, thumbnailKey: true, downloadCount: true, createdAt: true,
        },
      }),
      this.prisma.product.count({ where: { productTags: { some: { tagId: tag.id } }, status: 'PUBLISHED' } }),
    ]);

    return { tag, data: products, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async create(dto: CreateTagDto) {
    const slug = dto.slug || slugify(dto.name);
    const existing = await this.prisma.tag.findUnique({ where: { slug } });
    if (existing) throw new BadRequestException(`Tag slug "${slug}" already exists`);
    return this.prisma.tag.create({ data: { name: dto.name, slug } });
  }

  async remove(id: string) {
    const tag = await this.prisma.tag.findUnique({ where: { id } });
    if (!tag) throw new NotFoundException('Tag not found');
    return this.prisma.tag.delete({ where: { id } });
  }
}
