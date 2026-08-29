import { Controller, Post, Param, Req, HttpCode, HttpStatus } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { DownloadsService } from './downloads.service';
import { Request } from 'express';

@Controller('downloads')
export class DownloadsController {
  constructor(private readonly downloadsService: DownloadsService) {}

  /**
   * POST /api/downloads/free/:productId
   * Rate limited: 10 per minute per IP to prevent mass-scraping of free catalogue
   */
  @Throttle({ default: { limit: 10, ttl: 60000 } })
  @Post('free/:productId')
  @HttpCode(HttpStatus.OK)
  initiateFreeDownload(@Param('productId') productId: string, @Req() req: Request) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    return this.downloadsService.initiateFreeDownload(productId, ip);
  }

  /**
   * POST /api/downloads/paid/:orderId/:productId
   * Verifies order is paid before issuing download URL
   */
  @Post('paid/:orderId/:productId')
  @HttpCode(HttpStatus.OK)
  initiatePaidDownload(
    @Param('orderId') orderId: string,
    @Param('productId') productId: string,
    @Req() req: Request,
  ) {
    const ip = req.ip || req.headers['x-forwarded-for']?.toString() || 'unknown';
    return this.downloadsService.initiatePaidDownload(orderId, productId, ip);
  }
}
