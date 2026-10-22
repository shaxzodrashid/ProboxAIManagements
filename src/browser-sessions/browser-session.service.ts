import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ConflictException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { BrowserSession, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import { randomBytes, timingSafeEqual } from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { LoginDto } from "../auth/auth.dto";
import { PrismaService } from "../prisma/prisma.service";
import {
  BrowserSessionConfig,
  browserCookieName,
  browserDigest,
  browserSecret,
  decryptBrowserBundle,
  encryptBrowserBundle,
} from "./browser-session.config";

export const BROWSER_SESSION_CONFIG = Symbol("BROWSER_SESSION_CONFIG");
interface Bundle {
  csrfToken: string;
  accessToken?: string;
  refreshToken?: string;
  accessExpiresAt?: number;
  grant?: {
    purpose: "registration" | "password-reset";
    token: string;
    handleHash: string;
    expiresAt: number;
  };
}

@Injectable()
export class BrowserSessionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly jwt: JwtService,
    @Inject(BROWSER_SESSION_CONFIG) readonly config: BrowserSessionConfig,
  ) {}

  assertOrigin(req: Request, unsafe = false) {
    if (!this.config.enabled) throw new NotFoundException();
    if (
      req.headers.authorization ||
      req.headers["sec-fetch-site"] === "cross-site" ||
      (unsafe
        ? req.headers.origin !== this.config.origin
        : req.headers.origin !== undefined &&
          req.headers.origin !== this.config.origin)
    )
      throw new ForbiddenException("Browser request origin rejected");
    if (unsafe && !req.is("application/json"))
      throw new ForbiddenException("JSON required");
  }

  private cookie(req: Request) {
    const name = browserCookieName(this.config);
    const values = (req.headers.cookie ?? "")
      .split(";")
      .map((v) => v.trim())
      .filter((v) => v.startsWith(name + "="));
    if (values.length > 1)
      throw new UnauthorizedException("Ambiguous browser cookie");
    const value = values[0]?.slice(name.length + 1);
    if (value && !/^[A-Za-z0-9_-]{43}$/.test(value))
      throw new UnauthorizedException("Invalid browser cookie");
    return value;
  }

  private setCookie(res: Response, raw: string, expiresAt: Date) {
    res.cookie(browserCookieName(this.config), raw, {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(0, expiresAt.getTime() - Date.now()),
    });
  }

  private unpack(row: BrowserSession): Bundle {
    try {
      return decryptBrowserBundle<Bundle>(this.config, row.id, row.bundle);
    } catch {
      throw new ServiceUnavailableException(
        "Browser session storage is unavailable",
      );
    }
  }

  private async locked(tx: Prisma.TransactionClient, raw: string | undefined) {
    if (!raw) throw new UnauthorizedException("Browser session required");
    const id = browserDigest(raw);
    await tx.$queryRaw`SELECT "id" FROM "BrowserSession" WHERE "id" = ${id} FOR UPDATE`;
    const row = await tx.browserSession.findUnique({ where: { id } });
    if (
      !row ||
      row.revokedAt ||
      row.idleExpiresAt.getTime() <= Date.now() ||
      row.absoluteExpiresAt.getTime() <= Date.now()
    )
      throw new UnauthorizedException("Browser session expired");
    return row;
  }

  private csrf(req: Request, row: BrowserSession) {
    const value = req.headers["x-csrf-token"];
    if (
      typeof value !== "string" ||
      !/^[A-Za-z0-9_-]{43}$/.test(value) ||
      !timingSafeEqual(
        Buffer.from(browserDigest(value)),
        Buffer.from(row.csrfHash),
      )
    )
      throw new ForbiddenException("Invalid browser CSRF token");
  }

  private async transaction<T>(
    fn: (tx: Prisma.TransactionClient) => Promise<T>,
  ): Promise<T> {
    try {
      return await this.prisma.$transaction(fn, {
        maxWait: 5000,
        timeout: 15_000,
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError ||
        error instanceof Prisma.PrismaClientInitializationError
      )
        throw new ServiceUnavailableException(
          "Browser session storage is unavailable",
        );
      throw error;
    }
  }

  private async current(
    tx: Prisma.TransactionClient,
    row: BrowserSession,
    bundle: Bundle,
  ) {
    const refresh = row.refreshId
      ? await tx.sessionToken.findUnique({
          where: { id: row.refreshId },
          include: { user: true },
        })
      : null;
    if (
      !refresh ||
      refresh.purpose !== "REFRESH" ||
      refresh.revokedAt ||
      refresh.consumedAt ||
      refresh.expiresAt.getTime() <= Date.now() ||
      refresh.user.status !== "OPEN" ||
      refresh.userId !== row.userId ||
      refresh.user.workspaceId !== row.workspaceId ||
      !bundle.accessToken ||
      !bundle.refreshToken ||
      browserDigest(bundle.refreshToken) !== refresh.tokenHash
    )
      throw new UnauthorizedException("Browser session expired");
    return refresh;
  }

  async bootstrap(req: Request, res: Response) {
    this.assertOrigin(req);
    const raw = this.cookie(req);
    if (raw) {
      try {
        return await this.transaction(async (tx) => {
          const row = await this.locked(tx, raw),
            bundle = this.unpack(row);
          if (row.userId) await this.current(tx, row, bundle);
          return this.view(tx, row, bundle);
        });
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
      }
    }
    const next = browserSecret(),
      id = browserDigest(next),
      csrfToken = browserSecret();
    const expires = new Date(Date.now() + this.config.anonymousMs);
    const row = await this.transaction((tx) =>
      tx.browserSession.create({
        data: {
          id,
          csrfHash: browserDigest(csrfToken),
          bundle: encryptBrowserBundle(this.config, id, { csrfToken }),
          idleExpiresAt: expires,
          absoluteExpiresAt: expires,
        },
      }),
    );
    this.setCookie(res, next, expires);
    return this.view(this.prisma, row, { csrfToken });
  }

  private async view(
    tx: Prisma.TransactionClient,
    row: BrowserSession,
    bundle: Bundle,
  ) {
    if (!row.userId)
      return {
        authenticated: false as const,
        csrfToken: bundle.csrfToken,
        csrfExpiresAt: row.absoluteExpiresAt.toISOString(),
      };
    const user = await tx.user.findUniqueOrThrow({
      where: { id: row.userId },
      select: {
        id: true,
        workspaceId: true,
        fullName: true,
        roleAssignments: {
          select: {
            role: {
              select: { permissions: { select: { permissionKey: true } } },
            },
          },
        },
      },
    });
    return {
      authenticated: true as const,
      csrfToken: bundle.csrfToken,
      user: {
        id: user.id,
        workspaceId: user.workspaceId,
        displayName: user.fullName ?? "",
      },
      permissions: [
        ...new Set(
          user.roleAssignments.flatMap((a) =>
            a.role.permissions.map((p) => p.permissionKey),
          ),
        ),
      ].sort(),
      idleExpiresAt: row.idleExpiresAt.toISOString(),
      absoluteExpiresAt: row.absoluteExpiresAt.toISOString(),
    };
  }

  async login(req: Request, res: Response, dto: LoginDto) {
    this.assertOrigin(req, true);
    const raw = this.cookie(req),
      next = browserSecret(),
      nextId = browserDigest(next);
    let issuedRefresh: string | undefined;
    try {
      const result = await this.transaction(async (tx) => {
        const previous = await this.locked(tx, raw);
        this.csrf(req, previous);
        if (previous.userId)
          throw new ConflictException("Sign out before changing accounts");
        const tokens = await this.auth.login(dto, tx);
        issuedRefresh = browserDigest(tokens.refreshToken);
        const refresh = await tx.sessionToken.findUniqueOrThrow({
          where: { tokenHash: issuedRefresh },
          include: { user: true },
        });
        const csrfToken = browserSecret();
        const bundle: Bundle = {
          ...tokens,
          csrfToken,
          accessExpiresAt: this.accessExpiry(tokens.accessToken),
        };
        const absoluteExpiresAt = new Date(
          Math.min(
            Date.now() + this.config.absoluteMs,
            refresh.expiresAt.getTime(),
          ),
        );
        const row = await tx.browserSession.create({
          data: {
            id: nextId,
            userId: refresh.userId,
            workspaceId: refresh.user.workspaceId,
            refreshId: refresh.id,
            bundle: encryptBrowserBundle(this.config, nextId, bundle),
            csrfHash: browserDigest(csrfToken),
            idleExpiresAt: new Date(
              Math.min(
                Date.now() + this.config.idleMs,
                absoluteExpiresAt.getTime(),
              ),
            ),
            absoluteExpiresAt,
          },
        });
        await tx.browserSession.update({
          where: { id: previous.id },
          data: { revokedAt: new Date() },
        });
        return {
          view: await this.view(tx, row, bundle),
          expiresAt: absoluteExpiresAt,
        };
      });
      this.setCookie(res, next, result.expiresAt);
      return result.view;
    } catch (error) {
      // A commit acknowledgement can be lost: revoke this newly issued row if present.
      if (issuedRefresh)
        await this.prisma.sessionToken
          .updateMany({
            where: { tokenHash: issuedRefresh },
            data: { revokedAt: new Date() },
          })
          .catch(() => {});
      throw error;
    }
  }

  private accessExpiry(token: string) {
    const value = this.jwt.verify<{ exp: number }>(token);
    if (!Number.isFinite(value.exp))
      throw new ServiceUnavailableException("Invalid access expiry");
    return value.exp * 1000;
  }

  /** PostgreSQL row lock serializes refresh with every browser logout across replicas. */
  async authorize(req: Request, touch: boolean) {
    this.assertOrigin(req, !["GET", "HEAD"].includes(req.method));
    return this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req)),
        bundle = this.unpack(row);
      if (!["GET", "HEAD"].includes(req.method)) this.csrf(req, row);
      await this.current(tx, row, bundle);
      if (
        !bundle.accessExpiresAt ||
        bundle.accessExpiresAt <= Date.now() + 60_000
      ) {
        const refreshed = await this.auth.refresh(bundle.refreshToken!, tx);
        bundle.accessToken = refreshed.accessToken;
        bundle.accessExpiresAt = this.accessExpiry(refreshed.accessToken);
      }
      const idleExpiresAt = touch
        ? new Date(
            Math.min(
              Date.now() + this.config.idleMs,
              row.absoluteExpiresAt.getTime(),
            ),
          )
        : row.idleExpiresAt;
      await tx.browserSession.update({
        where: { id: row.id },
        data: {
          bundle: encryptBrowserBundle(this.config, row.id, bundle),
          idleExpiresAt,
        },
      });
      return {
        accessToken: bundle.accessToken!,
        deadline: Math.min(
          idleExpiresAt.getTime(),
          row.absoluteExpiresAt.getTime(),
          bundle.accessExpiresAt!,
        ),
      };
    });
  }

  /** Anonymous browser authentication still requires an enabled origin and CSRF on writes. */
  async anonymous(req: Request) {
    this.assertOrigin(req, req.method !== "GET");
    return this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      if (req.method !== "GET") this.csrf(req, row);
      if (row.userId)
        throw new ConflictException("Sign out before changing credentials");
      return row;
    });
  }

  async rememberGrant(
    req: Request,
    purpose: "registration" | "password-reset",
    value: { temporaryToken: string; expiresInSeconds: number },
  ) {
    const handle = randomBytes(48).toString("base64url");
    return this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      this.csrf(req, row);
      if (row.userId) throw new ConflictException("Browser identity changed");
      const bundle = this.unpack(row);
      const expiresAt = Math.min(
        Date.now() + value.expiresInSeconds * 1000,
        row.absoluteExpiresAt.getTime(),
      );
      bundle.grant = {
        purpose,
        token: value.temporaryToken,
        handleHash: browserDigest(handle),
        expiresAt,
      };
      await tx.browserSession.update({
        where: { id: row.id },
        data: { bundle: encryptBrowserBundle(this.config, row.id, bundle) },
      });
      // This handle is session-bound; the actual purpose token never leaves the server.
      return {
        temporaryToken: handle,
        expiresInSeconds: Math.max(
          1,
          Math.floor((expiresAt - Date.now()) / 1000),
        ),
      };
    });
  }

  async temporaryGrant(
    req: Request,
    purpose: "registration" | "password-reset",
  ) {
    const row = await this.anonymous(req);
    const handle = req.headers["x-browser-grant"];
    const grant = this.unpack(row).grant;
    if (
      typeof handle !== "string" ||
      !/^[A-Za-z0-9_-]{64}$/.test(handle) ||
      !grant ||
      grant.purpose !== purpose ||
      grant.expiresAt <= Date.now() ||
      !timingSafeEqual(
        Buffer.from(browserDigest(handle)),
        Buffer.from(grant.handleHash),
      )
    )
      throw new UnauthorizedException("Browser verification expired");
    return grant.token;
  }

  async forgetGrant(req: Request) {
    return this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      const bundle = this.unpack(row);
      const handle = req.headers["x-browser-grant"];
      if (
        typeof handle === "string" &&
        bundle.grant?.handleHash === browserDigest(handle)
      ) {
        delete bundle.grant;
        await tx.browserSession.update({
          where: { id: row.id },
          data: { bundle: encryptBrowserBundle(this.config, row.id, bundle) },
        });
      }
    });
  }

  async logout(req: Request, res: Response) {
    this.assertOrigin(req, true);
    const raw = this.cookie(req);
    if (raw)
      await this.transaction(async (tx) => {
        const id = browserDigest(raw);
        await tx.$queryRaw`SELECT "id" FROM "BrowserSession" WHERE "id" = ${id} FOR UPDATE`;
        const row = await tx.browserSession.findUnique({ where: { id } });
        if (row && !row.revokedAt) {
          this.csrf(req, row);
          await tx.browserSession.update({
            where: { id },
            data: { revokedAt: new Date() },
          });
          if (row.refreshId)
            await tx.sessionToken.update({
              where: { id: row.refreshId },
              data: { revokedAt: new Date() },
            });
        }
      });
    res.clearCookie(browserCookieName(this.config), {
      httpOnly: true,
      secure: this.config.secure,
      sameSite: "lax",
      path: "/",
    });
  }
}
