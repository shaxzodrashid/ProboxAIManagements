import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { validate } from "class-validator";
import { randomUUID } from "node:crypto";
import { ArticleProposalsController } from "../src/articles/article-proposals.controller";
import { ArticleProposalsService } from "../src/articles/article-proposals.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { StageArticleProposalDto } from "../src/articles/article-proposals.dto";
describe("private article staging explicit contracts", () => {
  it("exposes four private foundation routes without merge, dispatch or publication writes", async () => {
    const module = await Test.createTestingModule({
      controllers: [ArticleProposalsController],
      providers: [
        { provide: ArticleProposalsService, useValue: {} },
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
      const ops = Object.values(d.paths).flatMap((p) => Object.values(p!));
      expect(ops).toHaveLength(4);
      for (const op of ops) {
        expect(op.security).toEqual([{ "access-token": [] }]);
        expect(op.responses["403"]).toBeDefined();
        expect(op.responses["404"]).toBeDefined();
      }
      for (const [path, item] of Object.entries(d.paths)) {
        expect(path).not.toMatch(
          /dispatch|merge|voters|votes|publications|versions/,
        );
        if (item?.get) expect(item.get.responses["503"]).toBeDefined();
      }
      const stage =
        d.paths["/projects/{projectId}/article-proposal-candidates"]!.post!;
      expect(stage.description).toContain("dispatchAvailable is false");
      expect(stage.parameters).toContainEqual(
        expect.objectContaining({ name: "If-Match", required: true }),
      );
      expect(d.components!.schemas!.ExactArticleComparisonDto).toHaveProperty(
        "properties.before",
      );
      expect(d.components!.schemas!.ExactArticleComparisonDto).toHaveProperty(
        "properties.after",
      );
      expect(
        d.components!.schemas!.ArticleCandidateSummaryDto,
      ).not.toHaveProperty("properties.sequence");
    } finally {
      await app.close();
    }
  });
  it("marks all foundation operations no-store", () => {
    for (const key of ["reserve", "stage", "list", "read"] as const)
      expect(
        Reflect.getMetadata(
          HEADERS_METADATA,
          ArticleProposalsController.prototype[key],
        ),
      ).toContainEqual({ name: "Cache-Control", value: "no-store" });
  });
  const body = () => ({
    id: randomUUID(),
    documentId: randomUUID(),
    sourceArticleId: randomUUID(),
    baseVersionId: null,
    baseForestRevision: 0,
    positions: [],
    readingOrder: [],
  });
  it("accepts explicit null base and parent without treating absent fields as null", async () => {
    expect(
      await validate(Object.assign(new StageArticleProposalDto(), body())),
    ).toHaveLength(0);
    for (const field of ["baseVersionId", "positions"]) {
      const input: any = body();
      delete input[field];
      expect(
        (
          await validate(Object.assign(new StageArticleProposalDto(), input))
        ).map((e) => e.property),
      ).toContain(field);
    }
  });
  it.each([
    { baseForestRevision: -1 },
    { baseForestRevision: 2147483647 },
    { readingOrder: [randomUUID(), "bad"] },
    { positions: [{ id: randomUUID(), parentId: 5 }] },
    { baseVersionId: "bad" },
  ])("rejects malformed source/base/placement fields %p", async (changed) => {
    expect(
      (
        await validate(
          Object.assign(new StageArticleProposalDto(), body(), changed),
        )
      ).length,
    ).toBeGreaterThan(0);
  });
});
