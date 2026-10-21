import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { ArticleReviewsController } from "../src/articles/article-reviews.controller";
import { ArticleReviewsService } from "../src/articles/article-reviews.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("article review explicit HTTP contracts", () => {
  it("documents all seven routes, required revisions, access security, DTOs and read503", async () => {
    const module = await Test.createTestingModule({
      controllers: [ArticleReviewsController],
      providers: [
        { provide: ArticleReviewsService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      const d = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth(undefined, "access-token").build(),
      );
      const operations = Object.values(d.paths).flatMap((p) =>
        Object.values(p!),
      );
      expect(operations).toHaveLength(7);
      for (const op of operations) {
        expect(op.security).toEqual([{ "access-token": [] }]);
        for (const code of ["401", "403", "404"])
          expect(op.responses[code]).toBeDefined();
        expect(op.responses["200"] ?? op.responses["201"]).toHaveProperty(
          "content.application/json.schema.$ref",
        );
      }
      for (const [route, item] of Object.entries(d.paths)) {
        if (item?.get) expect(item.get.responses["503"]).toBeDefined();
        for (const op of [item?.post, item?.put])
          if (op) {
            expect(op.parameters).toContainEqual(
              expect.objectContaining({
                name: "If-Match",
                in: "header",
                required: true,
              }),
            );
            expect(op.responses["428"]).toBeDefined();
            expect(op.responses["409"]).toBeDefined();
          }
        expect(route).not.toMatch(/restore|media|override/);
      }
      expect(
        d.components?.schemas?.ArticlePublicationResponseDto,
      ).not.toHaveProperty("properties.voters");
    } finally {
      await app.close();
    }
  });
  it("marks every operation no-store", () => {
    for (const key of [
      "submit",
      "list",
      "read",
      "select",
      "vote",
      "publications",
      "publication",
    ] as const)
      expect(
        Reflect.getMetadata(
          HEADERS_METADATA,
          ArticleReviewsController.prototype[key],
        ),
      ).toContainEqual({ name: "Cache-Control", value: "no-store" });
  });
});
