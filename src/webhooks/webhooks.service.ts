import {
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import * as crypto from 'crypto';

@Injectable()
export class WebhooksService {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private prisma: PrismaService,
    private configService: ConfigService,
  ) {}

  /**
   * Verify Paddle webhook signature and process events.
   * Paddle uses HMAC-SHA256 with ts:h1=<hash> format.
   */
  async handleEvent(payload: any, rawBody: string, signature: string) {
    this.verifySignature(rawBody, signature);

    const eventType: string = payload.event_type || payload.event;
    this.logger.log(`Paddle event received: ${eventType}`);

    // Handle Paddle Billing events
    switch (eventType) {
      case 'transaction.completed':
        await this.handleTransactionCompleted(payload);
        break;
      case 'transaction.paid':
        await this.handleTransactionCompleted(payload);
        break;
      case 'transaction.refunded':
        await this.handleTransactionRefunded(payload);
        break;
      default:
        this.logger.log(`Unhandled Paddle event: ${eventType}`);
    }
  }

  private verifySignature(rawBody: string, signature: string) {
    const secret = this.configService?.get<string>('PADDLE_WEBHOOK_SECRET') || process.env.PADDLE_WEBHOOK_SECRET;
    if (!secret) {
      this.logger.warn('PADDLE_WEBHOOK_SECRET not set — skipping verification (dev mode)');
      return;
    }

    if (!signature) {
      throw new UnauthorizedException('Missing Paddle signature');
    }

    // Paddle signature format: ts=<timestamp>;h1=<hash>
    const parts = Object.fromEntries(
      signature.split(';').map((part) => part.split('=')),
    );
    const ts = parts.ts;
    const h1 = parts.h1;

    if (!ts || !h1) {
      throw new UnauthorizedException('Invalid Paddle signature format');
    }

    const signedPayload = `${ts}:${rawBody}`;
    const expectedHash = crypto
      .createHmac('sha256', secret)
      .update(signedPayload)
      .digest('hex');

    if (expectedHash !== h1) {
      throw new UnauthorizedException('Paddle signature verification failed');
    }
  }

  private async handleTransactionCompleted(payload: any) {
    const transaction = payload.data;
    const transactionId = transaction?.id;
    const email = transaction?.customer?.email || transaction?.billing_details?.email || '';
    const items = transaction?.items || [];
    const totalAmount = parseFloat(transaction?.details?.totals?.total || '0') / 100;
    const currency = transaction?.currency_code || 'USD';

    if (!transactionId) {
      this.logger.error('Transaction ID missing from Paddle payload');
      return;
    }

    // Idempotency: skip if order already exists
    const existing = await this.prisma.order.findUnique({
      where: { paddleOrderId: transactionId },
    });
    if (existing) {
      this.logger.log(`Order ${transactionId} already processed`);
      return;
    }

    // Map Paddle items to product IDs via custom_data
    // We expect each item to have custom_data.productId set at checkout creation time
    const orderItemsData: { productId: string; priceAtPurchase: number }[] = [];

    for (const item of items) {
      const productId = item.price?.custom_data?.productId || item.custom_data?.productId;
      if (!productId) continue;

      const price = parseFloat(item.totals?.subtotal || item.price?.unit_price?.amount || '0') / 100;
      orderItemsData.push({ productId, priceAtPurchase: price });
    }

    // Create order + order_items in a transaction
    await this.prisma.$transaction(async (tx) => {
      const order = await tx.order.create({
        data: {
          paddleOrderId: transactionId,
          email,
          status: 'PAID',
          totalAmount,
          currency,
          orderItems: {
            create: orderItemsData,
          },
        },
      });

      this.logger.log(`Order created: ${order.id} (Paddle: ${transactionId})`);
    });
  }

  private async handleTransactionRefunded(payload: any) {
    const transactionId = payload.data?.id;
    if (!transactionId) return;

    await this.prisma.order.updateMany({
      where: { paddleOrderId: transactionId },
      data: { status: 'REFUNDED' },
    });

    this.logger.log(`Order refunded: Paddle transaction ${transactionId}`);
  }
}
