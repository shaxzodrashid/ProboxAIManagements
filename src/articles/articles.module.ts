import { Module } from "@nestjs/common";
import { AuthModule } from "../auth/auth.module";
import { PrismaModule } from "../prisma/prisma.module";
import { ArticlesController } from "./articles.controller";
import { ArticlesService } from "./articles.service";
import { ArticleReviewsController } from "./article-reviews.controller";
import { ArticleReviewsService } from "./article-reviews.service";
import { ArticleProposalsController } from "./article-proposals.controller";
import { ArticleProposalsService } from "./article-proposals.service";
import { ArticleResolutionController } from "./article-resolution.controller";
import { ArticleResolutionService } from "./article-resolution.service";
import { ArticleCanonicalService } from "./article-canonical.service";
import { ArticleCanonicalController } from "./article-canonical.controller";
@Module({
  imports: [AuthModule, PrismaModule],
  controllers: [
    ArticlesController,
    ArticleReviewsController,
    ArticleProposalsController,
    ArticleResolutionController,
    ArticleCanonicalController,
  ],
  providers: [
    ArticlesService,
    ArticleReviewsService,
    ArticleProposalsService,
    ArticleResolutionService,
    ArticleCanonicalService,
  ],
})
export class ArticlesModule {}
