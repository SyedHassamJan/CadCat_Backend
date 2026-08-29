import {
  Injectable,
  NotFoundException,
  ForbiddenException,
  GoneException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class DownloadsService {
  private tokenTtlMinutes: number;

  constructor(
    private prisma: PrismaService,
    private storage: StorageService,
    private configService?: ConfigService,
  ) {
    this.tokenTtlMinutes = parseInt(
      configService?.get('DOWNLOAD_TOKEN_TTL_MINUTES') || process.env.DOWNLOAD_TOKEN_TTL_MINUTES || '15',
      10,
    );
  }

  /**
   * Initiate a FREE product download.
   * Creates a short-lived download token and returns a pre-signed URL.
   * The browser NEVER gets the raw S3 key or bucket URL.
   */
  async initiateFreeDownload(productId: string, ipAddress: string) {
    const product = await this.prisma.product.findUnique({
      where: { id: productId, status: 'PUBLISHED' },
    });

    if (!product) throw new NotFoundException('Product not found');
    if (!product.isFree) throw new ForbiddenException('This product requires purchase');
    if (!product.fileKey) throw new NotFoundException('File not yet available');

    // Create a download token
    const token = uuidv4();
    const expiresAt = new Date(Date.now() + this.tokenTtlMinutes * 60 * 1000);

    await this.prisma.downloadToken.create({
      data: {
        token,
        productId,
        expiresAt,
        ipAddress,
      },
    });

    // Increment download count
    await this.prisma.product.update({
      where: { id: productId },
      data: { downloadCount: { increment: 1 } },
    });

    // Generate pre-signed URL (short TTL = tokenTtlMinutes)
    const downloadUrl = await this.storage.getPresignedDownloadUrl(
      product.fileKey,
      this.tokenTtlMinutes * 60,
    );

    return {
      downloadUrl,
      expiresAt,
      filename: `${product.slug}.${product.fileFormat || 'dwg'}`,
    };
  }

  /**
   * Initiate a PAID product download.
   * Verifies the order is paid and the product is in the order.
   * The browser NEVER gets the raw S3 key or bucket URL.
   */
  async initiatePaidDownload(orderId: string, productId: string, ipAddress: string) {
    const orderItem = await this.prisma.orderItem.findFirst({
      where: {
        orderId,
        productId,
        order: { status: 'PAID' },
      },
      include: {
        order: true,
        product: true,
      },
    });

    if (!orderItem) {
      throw new ForbiddenException(
        'Download not authorized: order not found, not paid, or product not in order',
      );
    }

    if (!orderItem.product.fileKey) {
      throw new NotFoundException('File not yet available');
    }

    // Check if token already exists (re-download flow)
    const existingToken = await this.prisma.downloadToken.findFirst({
      where: { orderItemId: orderItem.id, usedAt: null },
    });

    let token: string;
    let expiresAt: Date;

    if (existingToken && existingToken.expiresAt > new Date()) {
      // Reuse existing valid token
      token = existingToken.token;
      expiresAt = existingToken.expiresAt;
    } else {
      // Create new token
      token = uuidv4();
      expiresAt = new Date(Date.now() + this.tokenTtlMinutes * 60 * 1000);

      await this.prisma.downloadToken.create({
        data: {
          token,
          productId,
          orderItemId: orderItem.id,
          expiresAt,
          ipAddress,
        },
      });
    }

    const downloadUrl = await this.storage.getPresignedDownloadUrl(
      orderItem.product.fileKey,
      this.tokenTtlMinutes * 60,
    );

    return {
      downloadUrl,
      expiresAt,
      filename: `${orderItem.product.slug}.${orderItem.product.fileFormat || 'dwg'}`,
    };
  }
}
