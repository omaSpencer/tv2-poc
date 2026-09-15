import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { environmentFile, validateConfig } from './config.js';
import { DatabaseService } from './database.js';
import { HealthController } from './health.js';

@Module({
  imports: [ConfigModule.forRoot({
    isGlobal: true,
    envFilePath: environmentFile(process.env),
    validate: validateConfig,
  })],
  controllers: [HealthController],
  providers: [DatabaseService],
})
export class AppModule {}
