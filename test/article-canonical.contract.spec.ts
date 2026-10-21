import "reflect-metadata";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { SwaggerModule, DocumentBuilder } from "@nestjs/swagger";
import { ArticleCanonicalController } from "../src/articles/article-canonical.controller";
import { ArticleCanonicalService } from "../src/articles/article-canonical.service";
import { PrismaService } from "../src/prisma/prisma.service";
import { CastArticleApprovalDto } from "../src/articles/article-resolution.dto";
import { plainToInstance } from "class-transformer";
import { validate } from "class-validator";
describe("canonical published article contracts", () => {
  it("exposes only authenticated current-tree and current-head reads without private provenance or history/restore actions", async () => {
    const module = await Test.createTestingModule({
      controllers: [ArticleCanonicalController],
      providers: [
        { provide: ArticleCanonicalService, useValue: {} },
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
      expect(Object.keys(d.paths)).toHaveLength(2);
      for (const p of Object.values(d.paths)) {
        expect(Object.keys(p!)).toEqual(["get"]);
        expect(p!.get!.security).toEqual([{ "access-token": [] }]);
        for (const status of ["403", "404", "503"])
          expect(p!.get!.responses[status]).toBeDefined();
      }
      const publicSchema = d.components!.schemas!
        .CanonicalArticlePublicationDto as any;
      expect(Object.keys(publicSchema.properties).sort()).toEqual([
        "article",
        "documentId",
        "forestRevision",
        "nextId",
        "number",
        "previousId",
        "versionId",
      ]);
    } finally {
      await app.close();
    }
  });
  it.each([{}, { approved: null }, { approved: "true" }, { approved: 1 }])(
    "requires an explicit boolean approval %p",
    async (value) => {
      expect(
        (await validate(plainToInstance(CastArticleApprovalDto, value))).length,
      ).toBeGreaterThan(0);
    },
  );
  it("accepts both explicit approve and reject without inferring an absent vote", async () => {
    for (const approved of [true, false])
      expect(
        await validate(plainToInstance(CastArticleApprovalDto, { approved })),
      ).toEqual([]);
  });
});
