import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import type { AppConfig } from './config';

export async function createApp(config: AppConfig): Promise<INestApplication> {
  const app = await NestFactory.create(AppModule.forRoot(config), {
    logger: config.NODE_ENV === 'test' ? false : undefined,
  });
  // §8: واجهة REST واحدة بإصدار /api/v1 للويب والجوال والتكاملات.
  app.setGlobalPrefix('api/v1');
  app.enableCors({ origin: config.CORS_ORIGINS, credentials: true });
  app.enableShutdownHooks();
  const http = app.getHttpAdapter().getInstance() as {
    disable(s: string): void;
    set(k: string, v: unknown): void;
  };
  http.disable('x-powered-by');
  http.set('trust proxy', 1);
  return app;
}
