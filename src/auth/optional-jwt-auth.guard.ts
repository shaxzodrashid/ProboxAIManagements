import { ExecutionContext, Injectable } from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { PrismaService } from "../prisma/prisma.service";
import { JwtAuthGuard } from "./auth.guards";

@Injectable()
export class OptionalJwtAuthGuard extends JwtAuthGuard {
  constructor(jwt: JwtService, prisma: PrismaService) {
    super(jwt, prisma);
  }
  override canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context
      .switchToHttp()
      .getRequest<{ headers: { authorization?: string } }>();
    // A supplied invalid credential must not silently become an anonymous request.
    return request.headers.authorization === undefined
      ? Promise.resolve(true)
      : super.canActivate(context);
  }
}
