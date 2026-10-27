import {
  INestApplication,
  NotFoundException,
  UnauthorizedException,
} from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { JwtService } from "@nestjs/jwt";
import { randomUUID } from "node:crypto";
import { BrowserSessionController } from "../src/browser-sessions/browser-session.controller";
import { BrowserSessionService } from "../src/browser-sessions/browser-session.service";
import { PublicProfileAvatarController } from "../src/accounts/profile-avatar.controller";
import { ProfileAvatarService } from "../src/accounts/profile-avatar.service";
import { PrismaService } from "../src/prisma/prisma.service";

describe("browser project avatar proxy transport", () => {
  let app: INestApplication;
  let baseUrl: string;
  const viewerId = randomUUID(),
    workspaceId = randomUUID();
  const ownerId = randomUUID(),
    assetId = randomUUID();
  const endpoint = `/api/v1/browser/api/profiles/${ownerId}/avatar/${assetId}`;
  const png = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aZs8AAAAASUVORK5CYII=",
    "base64",
  );
  const jwt = new JwtService({ secret: "local-browser-avatar-transport-test" });
  const authorize = jest.fn();
  const publicContent = jest.fn();
  beforeAll(async () => {
    const module = await Test.createTestingModule({
      controllers: [BrowserSessionController, PublicProfileAvatarController],
      providers: [
        { provide: BrowserSessionService, useValue: { authorize } },
        { provide: ProfileAvatarService, useValue: { publicContent } },
        { provide: JwtService, useValue: jwt },
        {
          provide: PrismaService,
          useValue: {
            user: {
              findFirst: async () => ({
                id: viewerId,
                workspaceId,
                authRevokedAt: null,
                roleAssignments: [],
              }),
            },
          },
        },
      ],
    }).compile();
    app = module.createNestApplication();
    app.setGlobalPrefix("api/v1");
    await app.listen(0, "127.0.0.1");
    baseUrl = await app.getUrl();
  });
  beforeEach(() => {
    authorize.mockReset().mockResolvedValue({
      accessToken: jwt.sign({ id: viewerId, type: "access" }),
      deadline: Date.now() + 60_000,
    });
    publicContent.mockReset().mockResolvedValue(png);
  });
  afterAll(async () => {
    await app?.close();
  });
  it("forwards binary PNG with the session viewer and private-image response headers", async () => {
    const response = await fetch(baseUrl + endpoint);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toMatch(/^image\/png/);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(Buffer.from(await response.arrayBuffer())).toEqual(png);
    expect(authorize).toHaveBeenCalledTimes(1);
    expect(publicContent).toHaveBeenCalledWith(
      ownerId,
      assetId,
      expect.objectContaining({ id: viewerId, workspaceId }),
    );
  });
  it("preserves a hidden or removed photo's upstream 404", async () => {
    publicContent.mockRejectedValue(
      new NotFoundException("Avatar not available"),
    );
    const response = await fetch(baseUrl + endpoint);
    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toBe("no-store");
  });
  it("requires a browser session before reaching the image service", async () => {
    authorize.mockRejectedValue(
      new UnauthorizedException("Browser session required"),
    );
    const response = await fetch(baseUrl + endpoint);
    expect(response.status).toBe(401);
    expect(publicContent).not.toHaveBeenCalled();
  });
});
