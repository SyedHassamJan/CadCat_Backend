import {
  Controller,
  Post,
  Req,
  Res,
  HttpCode,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { WebhooksService } from './webhooks.service';
import { Request, Response } from 'express';

@Controller('webhooks')
export class WebhooksController {
  private readonly logger = new Logger(WebhooksController.name);

  constructor(private readonly webhooksService: WebhooksService) {}

  /**
   * POST /api/webhooks/paddle
   * Receives Paddle webhook events.
   * Uses raw body for signature verification.
   */
  @Post('paddle')
  @HttpCode(HttpStatus.OK)
  async handlePaddleWebhook(@Req() req: Request, @Res() res: Response) {
    try {
      // Raw body is needed for HMAC signature verification
      const rawBody = (req as any).rawBody || JSON.stringify(req.body);
      const signature = req.headers['paddle-signature'] as string;

      await this.webhooksService.handleEvent(req.body, rawBody, signature);

      res.status(HttpStatus.OK).json({ received: true });
    } catch (error) {
      this.logger.error('Paddle webhook error', error);
      // Always return 200 to Paddle to prevent retries for non-recoverable errors
      res.status(HttpStatus.OK).json({ received: true, error: (error as any)?.message });
    }
  }
}
