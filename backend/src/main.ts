import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // The child-facing request page keeps a short, memorable URL.
  // The child-facing surfaces sit at the root, not under /api: they are pages
  // and app assets typed or tapped on a kid's device, and a service worker can
  // only claim a scope at or below its own path. Listed explicitly rather than
  // by wildcard so nothing else leaks out from behind the prefix.
  app.setGlobalPrefix('api', {
    exclude: [
      'request',
      'status',
      'api/status',
      '/',
      'kids/manifest.webmanifest',
      'kids/sw.js',
      'kids/icon-192.png',
      'kids/icon-512.png',
      'kids/icon-maskable-512.png',
      'kids/push-config',
      'kids/subscribe',
      'kids/test',
    ],
  });
  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? '*').split(','),
    credentials: true,
  });
  app.useGlobalPipes(
    new ValidationPipe({ whitelist: true, transform: true }),
  );

  const port = Number(process.env.PORT ?? 3001);
  await app.listen(port, '0.0.0.0');
  new Logger('Bootstrap').log(`Home Guardian API listening on :${port}/api`);
}

bootstrap();
