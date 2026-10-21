import { randomUUID } from "node:crypto";
import { plainToInstance } from "class-transformer";
import { validateSync } from "class-validator";
import {
  decodeForest,
  DraftForest,
  validateForest,
} from "../src/articles/article-forest";
import {
  ArrangeArticleDraftsDto,
  CreateArticleDraftDto,
} from "../src/articles/articles.dto";
import {
  ExplicitGrantPermissionKeys,
  SystemRoleDefinitions,
} from "../src/authorization/permission.catalog";

const article = (id = randomUUID(), parentId: string | null = null) => ({
  id,
  parentId,
  title: "Synthetic draft",
  text: "Plain text",
});
describe("private article forest contract", () => {
  it("retains multiple roots and a reading order independent of hierarchy", () => {
    const a = article(),
      b = article(),
      c = article(randomUUID(), a.id);
    expect(() =>
      validateForest({
        format: 1,
        articles: [a, b, c],
        readingOrder: [c.id, b.id, a.id],
      }),
    ).not.toThrow();
  });
  it.each([
    "duplicate identity",
    "missing parent",
    "self cycle",
    "mutual cycle",
    "duplicate sequence",
    "missing sequence",
    "foreign sequence",
  ])("rejects %s", (kind) => {
    const a = article(),
      b = article();
    const forest: DraftForest = {
      format: 1,
      articles: [a, b],
      readingOrder: [a.id, b.id],
    };
    if (kind === "duplicate identity") b.id = a.id;
    if (kind === "missing parent") a.parentId = randomUUID();
    if (kind === "self cycle") a.parentId = a.id;
    if (kind === "mutual cycle") {
      a.parentId = b.id;
      b.parentId = a.id;
    }
    if (kind === "duplicate sequence") forest.readingOrder = [a.id, a.id];
    if (kind === "missing sequence") forest.readingOrder.pop();
    if (kind === "foreign sequence") forest.readingOrder[0] = randomUUID();
    expect(() => validateForest(forest)).toThrow();
  });
  it("allows depth eight and rejects depth nine", () => {
    const articles = [article()];
    for (let i = 1; i < 9; i++)
      articles.push(article(randomUUID(), articles[i - 1]!.id));
    expect(() =>
      validateForest({
        format: 1,
        articles: articles.slice(0, 8),
        readingOrder: articles.slice(0, 8).map((a) => a.id),
      }),
    ).not.toThrow();
    expect(() =>
      validateForest({
        format: 1,
        articles,
        readingOrder: articles.map((a) => a.id),
      }),
    ).toThrow();
  });
  it("caps the entire individual forest at 100", () => {
    const articles = Array.from({ length: 101 }, () => article());
    expect(() =>
      validateForest({
        format: 1,
        articles,
        readingOrder: articles.map((a) => a.id),
      }),
    ).toThrow();
  });
  it("explicitly projects stored content without internal or future fields", () => {
    const a = article();
    expect(
      decodeForest({
        format: 1,
        secret: "hidden",
        articles: [{ ...a, mediaKey: "private" }],
        readingOrder: [a.id],
      }),
    ).toEqual({ format: 1, articles: [a], readingOrder: [a.id] });
  });
  it("refuses to rewrite unrecognized retained fields during mutations", () => {
    const a = article();
    expect(() =>
      decodeForest(
        {
          format: 1,
          future: { retained: true },
          articles: [a],
          readingOrder: [a.id],
        },
        true,
      ),
    ).toThrow("content has been preserved");
    expect(() =>
      decodeForest(
        {
          format: 1,
          articles: [{ ...a, future: { retained: true } }],
          readingOrder: [a.id],
        },
        true,
      ),
    ).toThrow("content has been preserved");
  });
  it.each([
    null,
    { format: 2, articles: [], readingOrder: [] },
    { format: 1, articles: [{}], readingOrder: [] },
    { format: 1, articles: [], readingOrder: ["unknown"] },
  ])("fails closed for unsupported retained data %#", (value) => {
    expect(() => decodeForest(value)).toThrow(
      "Stored draft format requires compatible handling",
    );
  });
  it("requires an explicit nullable parent instead of treating omitted parent as root", () => {
    const dto = plainToInstance(ArrangeArticleDraftsDto, {
      articles: [{ id: randomUUID() }],
      readingOrder: [],
    });
    expect(validateSync(dto).length).toBeGreaterThan(0);
  });
  it("rejects unknown disclosure/publishing fields and rich content payloads", () => {
    const dto = plainToInstance(CreateArticleDraftDto, {
      id: randomUUID(),
      title: "Draft",
      text: { media: "secret" },
      published: true,
    });
    expect(
      validateSync(dto, { whitelist: true, forbidNonWhitelisted: true }).length,
    ).toBe(2);
  });
  it("does not grant either new capability to built-in roles", () => {
    for (const key of ["articles.create", "articles.edit"] as const) {
      expect(ExplicitGrantPermissionKeys).toContain(key);
      for (const role of SystemRoleDefinitions)
        expect(role.permissions).not.toContain(key);
    }
  });
});
