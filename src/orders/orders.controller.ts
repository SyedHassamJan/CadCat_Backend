import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import { OrdersService } from './orders.service';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@Controller('orders')
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  /** GET /api/orders/:id/status — public endpoint for order success page */
  @Get(':id/status')
  getOrderStatus(@Param('id') id: string) {
    return this.ordersService.getOrderStatus(id);
  }

  /** Admin routes */
  @UseGuards(JwtAuthGuard)
  @Get()
  findAll(
    @Query('page') page?: number,
    @Query('limit') limit?: number,
    @Query('search') search?: string,
  ) { return this.ordersService.findAll(page, limit, search); }

  @UseGuards(JwtAuthGuard)
  @Get(':id')
  findOne(@Param('id') id: string) { return this.ordersService.findOne(id); }
}
