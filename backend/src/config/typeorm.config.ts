import { ConfigService } from '@nestjs/config';
import { TypeOrmModuleOptions } from '@nestjs/typeorm';

/**
 * TypeORM connection options, built from env. `synchronize` is on outside
 * production for zero-friction local dev; in production, generate and run
 * migrations instead (see README) and keep synchronize off.
 */
export function buildTypeOrmOptions(
  config: ConfigService,
): TypeOrmModuleOptions {
  const isProd = config.get('NODE_ENV') === 'production';
  return {
    type: 'postgres',
    host: config.get<string>('POSTGRES_HOST', 'postgres'),
    port: config.get<number>('POSTGRES_PORT', 5432),
    username: config.get<string>('POSTGRES_USER', 'guardian'),
    password: config.get<string>('POSTGRES_PASSWORD', 'guardian'),
    database: config.get<string>('POSTGRES_DB', 'guardian'),
    autoLoadEntities: true,
    synchronize: !isProd,
    logging: config.get('DB_LOGGING') === 'true',
  };
}
