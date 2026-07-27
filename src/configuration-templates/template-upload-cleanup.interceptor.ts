import {
  CallHandler,
  ExecutionContext,
  Injectable,
  Logger,
  NestInterceptor,
} from "@nestjs/common";
import { Observable } from "rxjs";
import { removeTemporaryUpload } from "./configuration-templates.service";

type RequestWithUpload = { file?: { path?: string } };

@Injectable()
export class TemplateUploadCleanupInterceptor implements NestInterceptor {
  private readonly logger = new Logger(TemplateUploadCleanupInterceptor.name);

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<RequestWithUpload>();
    let cleanupPromise: Promise<void> | undefined;
    const cleanup = () => {
      cleanupPromise ??= removeTemporaryUpload(request.file?.path).catch(
        (error: unknown) => {
          this.logger.warn(
            `Unable to remove template upload spool file: ${errorMessage(error)}`,
          );
        },
      );
      return cleanupPromise;
    };

    return new Observable((subscriber) => {
      const subscription = next.handle().subscribe({
        next: (value) => subscriber.next(value),
        error: (error: unknown) => {
          void cleanup().finally(() => subscriber.error(error));
        },
        complete: () => {
          void cleanup().finally(() => subscriber.complete());
        },
      });
      return () => {
        subscription.unsubscribe();
        void cleanup();
      };
    });
  }
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}
