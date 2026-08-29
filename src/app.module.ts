import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule, ThrottlerGuard } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { AuthModule } from './auth/auth.module';
import { StorageModule } from './storage/storage.module';
import { ProductsModule } from './products/products.module';
import { CategoriesModule } from './categories/categories.module';
import { TagsModule } from './tags/tags.module';
import { DownloadsModule } from './downloads/downloads.module';
import { OrdersModule } from './orders/orders.module';
import { WebhooksModule } from './webhooks/webhooks.module';

@Module({
  imports: [
    // Config — loads .env file
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: '.env',
    }),

    // Rate limiting — global throttle
    ThrottlerModule.forRoot([
      {
        ttl: 60000,  // 1 minute
        limit: 60,   // 60 requests per minute globally
      },
    ]),

    // Core modules
    PrismaModule,
    AuthModule,
    StorageModule,
    ProductsModule,
    CategoriesModule,
    TagsModule,
    DownloadsModule,
    OrdersModule,
    WebhooksModule,
  ],
  providers: [
    // Apply rate limiting globally
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class AppModule {}
