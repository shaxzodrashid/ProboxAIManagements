import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { HEADERS_METADATA } from "@nestjs/common/constants";
import { ArticleResolutionController } from "../src/articles/article-resolution.controller";
import { ArticleResolutionService } from "../src/articles/article-resolution.service";
import { ArticleProposalsService } from "../src/articles/article-proposals.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { SetReviewerAlternativesDto } from "../src/articles/article-resolution.dto";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
describe("reviewer-resolution explicit contracts", () => {
  it("exposes submission, fixed reviewer dispatch, discovery/read and own choices without final votes", async () => {
    const module = await Test.createTestingModule({
      controllers: [ArticleResolutionController],
      providers: [
        { provide: ArticleResolutionService, useValue: {} },
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
      expect(ops).toHaveLength(8);
      for (const op of ops) {
        expect(op.security).toEqual([{ "access-token": [] }]);
        expect(op.responses["403"]).toBeDefined();
        expect(op.responses["404"]).toBeDefined();
      }
      for (const [path, item] of Object.entries(d.paths)) {
        expect(path).not.toMatch(/votes|publish|promote|restore/);
        if (item?.get) expect(item.get.responses["503"]).toBeDefined();
        for (const op of [item?.post, item?.put])
          if (op && !path.endsWith("/publication"))
            expect(op.parameters).toContainEqual(
              expect.objectContaining({ name: "If-Match", required: true }),
            );
      }
      expect(
        d.components!.schemas!.ArticleResolutionResponseDto,
      ).toHaveProperty("properties.finalVotingAvailable");
      expect(d.components!.schemas!.ArticleAlternativeDto).toHaveProperty(
        "properties.contributionIds",
      );
    } finally {
      await app.close();
    }
  });
  it("marks all six operations no-store", () => {
    for (const key of [
      "submit",
      "dispatch",
      "list",
      "read",
      "choose",
      "vote",
      "approve",
      "promote",
    ] as const)
      expect(
        Reflect.getMetadata(
          HEADERS_METADATA,
          ArticleResolutionController.prototype[key],
        ),
      ).toContainEqual({ name: "Cache-Control", value: "no-store" });
  });
  it.each([
    {},
    { choices: null },
    { choices: [null] },
    { choices: [{ conflictId: "bad", alternativeId: "bad" }] },
    {
      choices: Array.from({ length: 4 }, () => ({
        conflictId: "a".repeat(64),
        alternativeId: "b".repeat(64),
      })),
    },
  ])("rejects malformed or unbounded reviewer choices %p", async (input) =>
    expect(
      (await validate(plainToInstance(SetReviewerAlternativesDto, input)))
        .length,
    ).toBeGreaterThan(0),
  );
  it("accepts a bounded explicit alternative set and an empty conflict-free acknowledgement", async () => {
    for (const choices of [
      [],
      [{ conflictId: "a".repeat(64), alternativeId: "b".repeat(64) }],
    ])
      expect(
        await validate(
          plainToInstance(SetReviewerAlternativesDto, { choices }),
        ),
      ).toHaveLength(0);
  });
});
