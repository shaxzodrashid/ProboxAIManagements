import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { ArticlesController } from "../src/articles/articles.controller";
import { ArticlesService } from "../src/articles/articles.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("private article route contracts without a listening socket", () => {
  it("documents exactly the five draft operations with bearer security and explicit response DTOs", async () => {
    const module = await Test.createTestingModule({
      controllers: [ArticlesController],
      providers: [
        { provide: ArticlesService, useValue: {} },
        { provide: PrismaService, useValue: {} },
        { provide: JwtService, useValue: {} },
      ],
    }).compile();
    const app = module.createNestApplication();
    try {
      const document = SwaggerModule.createDocument(
        app,
        new DocumentBuilder().addBearerAuth(undefined, "access-token").build(),
      );
      expect(Object.keys(document.paths)).toEqual([
        "/projects/{projectId}/article-drafts",
        "/projects/{projectId}/article-drafts/{articleId}",
      ]);
      const operations = Object.values(document.paths).flatMap((path) =>
        Object.values(path!),
      );
      expect(operations).toHaveLength(5);
      for (const operation of operations) {
        expect(operation.security).toEqual([{ "access-token": [] }]);
        expect(operation.responses["401"]).toBeDefined();
        expect(operation.responses["403"]).toBeDefined();
        expect(operation.responses["404"]).toBeDefined();
        expect(
          operation.responses["200"] ?? operation.responses["201"],
        ).toHaveProperty("content.application/json.schema.$ref");
      }
      expect(
        document.components?.schemas?.ArticleDraftDetailResponseDto,
      ).toHaveProperty("properties.previousId");
    } finally {
      await app.close();
    }
  });
  it("marks every current operation as no-store", () => {
    for (const method of [
      "list",
      "detail",
      "create",
      "arrange",
      "edit",
    ] as const)
      expect(
        Reflect.getMetadata(
          HEADERS_METADATA,
          ArticlesController.prototype[method],
        ),
      ).toContainEqual({ name: "Cache-Control", value: "no-store" });
  });
});
