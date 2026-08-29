import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OrdersService {
  constructor(private prisma: PrismaService) {}

  async findAll(page = 1, limit = 20, search?: string) {
    const skip = (page - 1) * limit;
    const where: any = {};

    if (search) {
      where.OR = [
        { email: { contains: search, mode: 'insensitive' } },
        { paddleOrderId: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [orders, total] = await Promise.all([
      this.prisma.order.findMany({
        where,
        skip,
        take: limit,
        orderBy: { createdAt: 'desc' },
        include: {
          orderItems: {
            include: {
              product: { select: { id: true, title: true, slug: true } },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);

    return { data: orders, meta: { total, page, limit, totalPages: Math.ceil(total / limit) } };
  }

  async findOne(id: string) {
    const order = await this.prisma.order.findUnique({
      where: { id },
      include: {
        orderItems: {
          include: {
            product: { select: { id: true, title: true, slug: true, fileFormat: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }

  /** Called by the success page to get order status + download info */
  async getOrderStatus(id: string) {
    const order = await this.prisma.order.findFirst({
      where: {
        OR: [
          { id },
          { paddleOrderId: id },
        ],
      },
      select: {
        id: true,
        paddleOrderId: true,
        status: true,
        email: true,
        totalAmount: true,
        currency: true,
        createdAt: true,
        orderItems: {
          select: {
            id: true,
            priceAtPurchase: true,
            product: { select: { id: true, title: true, slug: true, fileFormat: true, previewImageKey: true, thumbnailKey: true } },
          },
        },
      },
    });
    if (!order) throw new NotFoundException('Order not found');
    return order;
  }
}
