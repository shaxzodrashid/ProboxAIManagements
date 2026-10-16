import {
  CallHandler,
  ExecutionContext,
  mixin,
  NestInterceptor,
} from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { MulterOptions } from "@nestjs/platform-express/multer/interfaces/multer-options.interface";

export function configuredUploadLimit(name: string, fallback: number) {
  const configured = Number(process.env[name]);
  return Number.isSafeInteger(configured) && configured > 0
    ? Math.min(configured, 1024 * 1024 * 1024)
    : fallback;
}

/** Resolve the same effective configuration as metadata/service checks per request. */
export function EffectiveFileInterceptor(options: () => MulterOptions) {
  class Interceptor implements NestInterceptor {
    intercept(context: ExecutionContext, next: CallHandler) {
      const Upload = FileInterceptor("file", options());
      return new Upload().intercept(context, next);
    }
  }
  return mixin(Interceptor);
}
