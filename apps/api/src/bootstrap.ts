import type { INestApplication } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { toNodeHandler } from 'better-auth/node';
import express from 'express';
import { AppModule, type AppOverrides } from './app.module';
import { AUTH } from './auth/auth.module';
import { AUTH_BASE_PATH, type Auth } from './auth/better-auth';
import type { AppConfig } from './config';

export async function createApp(
  config: AppConfig,
  overrides: AppOverrides = {},
): Promise<INestApplication> {
  // محلل الطلبات يُضاف يدوياً بعد مسار المصادقة: Better Auth يقرأ جسم الطلب بنفسه.
  const app = await NestFactory.create(AppModule.forRoot(config, overrides), {
    bodyParser: false,
    logger: config.NODE_ENV === 'test' ? false : undefined,
  });
  // §8: واجهة REST واحدة بإصدار /api/v1 للويب والجوال والتكاملات.
  app.setGlobalPrefix('api/v1');
  app.enableCors({
    origin: config.CORS_ORIGINS,
    credentials: true,
    exposedHeaders: ['set-auth-token', 'set-auth-jwt'],
  });
  app.enableShutdownHooks();

  const http = app.getHttpAdapter().getInstance() as express.Express;
  http.disable('x-powered-by');
  http.set('trust proxy', 1);
  // §6.3: مسارات Better Auth (الدخول، المصادقة الثنائية، الجلسات، رمز الوصول، JWKS).
  http.all(`${AUTH_BASE_PATH}/*splat`, toNodeHandler(app.get<Auth>(AUTH)));
  http.use(express.json({ limit: '1mb' }));
  return app;
}
