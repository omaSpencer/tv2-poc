import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentFile, validateConfig } from './config.js';
import { DatabaseModule } from './database.js';
import { HealthController } from './health.js';
import { ContentModule } from './content/content.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { OpsModule } from './ops/ops.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: environmentFile(process.env),
      validate: validateConfig,
    }),
    DatabaseModule,
    ContentModule,
    MessagingModule,
    OpsModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
