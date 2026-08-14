import { SetMetadata } from '@nestjs/common';

/** Marks a route as reachable without a valid JWT (login, health checks). */
export const IS_PUBLIC_KEY = 'isPublic';
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
