import {
  ForbiddenException,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  ConflictException,
  HttpException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { BrowserSession, Prisma } from "@prisma/client";
import type { Request, Response } from "express";
import {
  createHmac,
  randomBytes,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { AuthService } from "../auth/auth.service";
import { AuthLocale, LoginDto } from "../auth/auth.dto";
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
  inactivityMs?: number;
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
      (!row.rolling && row.absoluteExpiresAt.getTime() <= Date.now())
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
    if (row.refreshId)
      await tx.$queryRaw`SELECT "id" FROM "SessionToken" WHERE "id" = ${row.refreshId} FOR UPDATE`;
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
      (!refresh.managed &&
        browserDigest(bundle.refreshToken) !== refresh.tokenHash)
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
        passwordHash: true,
        telegramChatId: true,
        verifiedAt: true,
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
      // Compatibility deadline for old adapters; new clients use hardExpiresAt.
      absoluteExpiresAt: (row.rolling
        ? row.idleExpiresAt
        : row.absoluteExpiresAt
      ).toISOString(),
      expiryPolicy: row.rolling ? "rolling" : "absolute",
      hardExpiresAt: row.rolling ? null : row.absoluteExpiresAt.toISOString(),
      authenticatedAt: (row.authenticatedAt ?? row.createdAt).toISOString(),
      reauthenticationMethod: user.passwordHash
        ? "password"
        : user.verifiedAt && user.telegramChatId
          ? "telegram-otp"
          : "unavailable",
    };
  }

  async login(req: Request, res: Response, dto: LoginDto) {
    this.assertOrigin(req, true);
    const policy = req.headers["x-browser-session-policy"];
    if (policy !== undefined && policy !== "rolling-v1")
      throw new ForbiddenException("Unsupported browser session policy");
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
        const modernClient = policy === "rolling-v1";
        const inactivityMs = modernClient
          ? this.config.idleMs
          : Math.min(this.config.idleMs, 30 * 60_000);
        const capMs = modernClient
          ? this.config.absoluteMs
          : Math.min(
              this.config.absoluteMs || 8 * 60 * 60_000,
              8 * 60 * 60_000,
            );
        const csrfToken = browserSecret();
        const bundle: Bundle = {
          inactivityMs,
          ...tokens,
          csrfToken,
          accessExpiresAt: this.accessExpiry(tokens.accessToken),
        };
        const rolling = capMs === 0;
        const absoluteExpiresAt = new Date(
          Date.now() + (rolling ? inactivityMs : capMs),
        );
        const idleExpiresAt = new Date(
          Math.min(Date.now() + inactivityMs, absoluteExpiresAt.getTime()),
        );
        await tx.sessionToken.update({
          where: { id: refresh.id },
          data: { managed: true, expiresAt: idleExpiresAt },
        });
        await tx.refreshCredential.create({
          data: { sessionId: refresh.id, tokenHash: issuedRefresh! },
        });
        const row = await tx.browserSession.create({
          data: {
            id: nextId,
            userId: refresh.userId,
            workspaceId: refresh.user.workspaceId,
            refreshId: refresh.id,
            rolling,
            authenticatedAt: refresh.createdAt,
            bundle: encryptBrowserBundle(this.config, nextId, bundle),
            csrfHash: browserDigest(csrfToken),
            idleExpiresAt,
            absoluteExpiresAt,
          },
        });
        await tx.browserSession.update({
          where: { id: previous.id },
          data: { revokedAt: new Date() },
        });
        return {
          view: await this.view(tx, row, bundle),
          expiresAt: idleExpiresAt,
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
  async authorize(req: Request, touch: boolean, res?: Response) {
    this.assertOrigin(req, !["GET", "HEAD"].includes(req.method));
    const raw = this.cookie(req);
    const result = await this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req)),
        bundle = this.unpack(row);
      if (!["GET", "HEAD"].includes(req.method)) this.csrf(req, row);
      const refresh = await this.current(tx, row, bundle);
      if (
        !bundle.accessExpiresAt ||
        bundle.accessExpiresAt <= Date.now() + 60_000
      ) {
        if (refresh.managed) {
          const credential = await tx.refreshCredential.findUnique({
            where: { tokenHash: browserDigest(bundle.refreshToken!) },
          });
          if (
            !credential ||
            credential.sessionId !== refresh.id ||
            credential.consumedAt
          ) {
            // Return a rejection sentinel so revocation commits before throwing.
            await tx.sessionToken.update({
              where: { id: refresh.id },
              data: { revokedAt: new Date() },
            });
            return null;
          }
          const next = randomBytes(48).toString("base64url");
          await tx.refreshCredential.update({
            where: { id: credential.id },
            data: { consumedAt: new Date() },
          });
          await tx.refreshCredential.create({
            data: { sessionId: refresh.id, tokenHash: browserDigest(next) },
          });
          bundle.refreshToken = next;
          bundle.accessToken = this.auth.sessionAccessToken(
            refresh.user,
            refresh.id,
            row.authenticatedAt ?? refresh.createdAt,
          );
        } else {
          bundle.accessToken = (
            await this.auth.refresh(bundle.refreshToken!, tx)
          ).accessToken;
        }
        bundle.accessExpiresAt = this.accessExpiry(bundle.accessToken);
      }
      const idleExpiresAt = touch
        ? new Date(
            Math.min(
              Date.now() + (bundle.inactivityMs ?? this.config.idleMs),
              row.rolling ? Infinity : row.absoluteExpiresAt.getTime(),
            ),
          )
        : row.idleExpiresAt;
      if (touch && refresh.managed)
        await tx.sessionToken.update({
          where: { id: refresh.id },
          data: { expiresAt: idleExpiresAt },
        });
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
          row.rolling ? Infinity : row.absoluteExpiresAt.getTime(),
          bundle.accessExpiresAt!,
        ),
        cookieExpiresAt: idleExpiresAt,
      };
    });
    if (!result) throw new UnauthorizedException("Browser session expired");
    if (touch && res && raw) this.setCookie(res, raw, result.cookieExpiresAt);
    return result;
  }

  async activity(req: Request, res: Response) {
    await this.authorize(req, true, res);
    return this.bootstrap(req, res);
  }

  async reauthenticate(req: Request, res: Response, password: string) {
    this.assertOrigin(req, true);
    const success = await this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      this.csrf(req, row);
      const bundle = this.unpack(row);
      const refresh = await this.current(tx, row, bundle);
      if (
        row.reauthBlockedUntil &&
        row.reauthBlockedUntil.getTime() > Date.now()
      )
        throw new HttpException("Reauthentication temporarily limited", 429);
      try {
        const user = await this.auth.verifyCredentials(
          { username: refresh.user.username!, password },
          tx,
        );
        if (user.id !== row.userId) throw new UnauthorizedException();
      } catch (error) {
        if (!(error instanceof UnauthorizedException)) throw error;
        const failures =
          row.reauthBlockedUntil &&
          row.reauthBlockedUntil.getTime() <= Date.now()
            ? 1
            : row.reauthFailures + 1;
        await tx.browserSession.update({
          where: { id: row.id },
          data: {
            reauthFailures: failures,
            reauthBlockedUntil:
              failures >= 5 ? new Date(Date.now() + 10 * 60_000) : null,
          },
        });
        return false;
      }
      const authenticatedAt = new Date();
      bundle.accessToken = this.auth.sessionAccessToken(
        refresh.user,
        refresh.id,
        authenticatedAt,
      );
      bundle.accessExpiresAt = this.accessExpiry(bundle.accessToken);
      await tx.browserSession.update({
        where: { id: row.id },
        data: {
          authenticatedAt,
          reauthFailures: 0,
          reauthBlockedUntil: null,
          bundle: encryptBrowserBundle(this.config, row.id, bundle),
        },
      });
      return true;
    });
    if (!success) throw new UnauthorizedException("Reauthentication rejected");
    return this.activity(req, res);
  }

  private assertPasswordless(user: {
    passwordHash: string | null;
    verifiedAt: Date | null;
    telegramChatId: bigint | null;
  }) {
    if (user.passwordHash)
      throw new ForbiddenException("Password verification required");
    if (!user.verifiedAt || !user.telegramChatId)
      throw new ForbiddenException(
        "No verified authentication method is available",
      );
  }

  async sendStepUpOtp(req: Request, locale: AuthLocale) {
    this.assertOrigin(req, true);
    return this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      this.csrf(req, row);
      const root = await this.current(tx, row, this.unpack(row));
      this.assertPasswordless(root.user);
      const newWindow =
        !row.stepUpOtpWindowAt ||
        Date.now() - row.stepUpOtpWindowAt.getTime() >= 10 * 60_000;
      if (!newWindow && row.stepUpOtpSentCount >= 3)
        throw new HttpException("Too many verification requests", 429);
      const code = randomInt(100000, 1_000_000).toString();
      const hash = createHmac("sha256", this.config.key)
        .update(`step-up:${row.id}:${code}`)
        .digest("hex");
      await tx.browserSession.update({
        where: { id: row.id },
        data: {
          stepUpOtpHash: `${this.config.keyId}:${hash}`,
          stepUpOtpExpiresAt: new Date(Date.now() + 5 * 60_000),
          stepUpOtpAttempts: 0,
          stepUpOtpWindowAt: newWindow ? new Date() : row.stepUpOtpWindowAt,
          stepUpOtpSentCount: newWindow ? 1 : row.stepUpOtpSentCount + 1,
        },
      });
      await this.auth.deliverStepUpOtp(root.user.telegramChatId!, code, locale);
      return { expiresInSeconds: 300 };
    });
  }

  async verifyStepUpOtp(req: Request, res: Response, code: string) {
    this.assertOrigin(req, true);
    const accepted = await this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      this.csrf(req, row);
      const bundle = this.unpack(row);
      const root = await this.current(tx, row, bundle);
      this.assertPasswordless(root.user);
      const [keyId, hash] = (row.stepUpOtpHash ?? "").split(":");
      const key =
        keyId === this.config.keyId
          ? this.config.key
          : keyId &&
              Object.prototype.hasOwnProperty.call(
                this.config.previousKeys ?? {},
                keyId,
              )
            ? this.config.previousKeys![keyId]
            : undefined;
      const actual = key
        ? createHmac("sha256", key)
            .update(`step-up:${row.id}:${code}`)
            .digest("hex")
        : "";
      const valid =
        !!key &&
        !!hash &&
        /^[a-f0-9]{64}$/.test(hash) &&
        row.stepUpOtpAttempts < 5 &&
        !!row.stepUpOtpExpiresAt &&
        row.stepUpOtpExpiresAt.getTime() > Date.now() &&
        timingSafeEqual(Buffer.from(hash), Buffer.from(actual));
      if (!valid) {
        await tx.browserSession.update({
          where: { id: row.id },
          data: { stepUpOtpAttempts: { increment: 1 } },
        });
        return false;
      }
      const authenticatedAt = new Date();
      bundle.accessToken = this.auth.sessionAccessToken(
        root.user,
        root.id,
        authenticatedAt,
      );
      bundle.accessExpiresAt = this.accessExpiry(bundle.accessToken);
      await tx.browserSession.update({
        where: { id: row.id },
        data: {
          authenticatedAt,
          stepUpOtpHash: null,
          stepUpOtpExpiresAt: null,
          stepUpOtpAttempts: 0,
          bundle: encryptBrowserBundle(this.config, row.id, bundle),
        },
      });
      return true;
    });
    if (!accepted)
      throw new UnauthorizedException("Invalid or expired verification code");
    return this.activity(req, res);
  }

  async revokeSessions(req: Request, res: Response, sessionId?: string) {
    this.assertOrigin(req, true);
    await this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      this.csrf(req, row);
      await this.current(tx, row, this.unpack(row));
      if (
        Date.now() - (row.authenticatedAt ?? row.createdAt).getTime() >
        10 * 60_000
      )
        throw new ForbiddenException({
          statusCode: 403,
          code: "RECENT_AUTH_REQUIRED",
          message: "Recent authentication required",
        });
      const revoked = await tx.sessionToken.updateMany({
        where: {
          userId: row.userId!,
          purpose: "REFRESH",
          ...(sessionId ? { id: sessionId } : {}),
        },
        data: { revokedAt: new Date() },
      });
      if (sessionId && !revoked.count)
        throw new NotFoundException("Device session not found");
      if (!sessionId)
        await tx.user.update({
          where: { id: row.userId! },
          data: { authRevokedAt: new Date() },
        });
    });
    if (!sessionId)
      res.clearCookie(browserCookieName(this.config), {
        httpOnly: true,
        secure: this.config.secure,
        sameSite: "lax",
        path: "/",
      });
  }

  async devices(req: Request) {
    this.assertOrigin(req);
    return this.transaction(async (tx) => {
      const row = await this.locked(tx, this.cookie(req));
      await this.current(tx, row, this.unpack(row));
      const sessions = await tx.sessionToken.findMany({
        where: {
          userId: row.userId!,
          purpose: "REFRESH",
          revokedAt: null,
          consumedAt: null,
          expiresAt: { gt: new Date() },
        },
        orderBy: [{ createdAt: "desc" }, { id: "asc" }],
        take: 100,
        select: { id: true, createdAt: true, expiresAt: true },
      });
      return {
        items: sessions.map((s) => ({
          id: s.id,
          createdAt: s.createdAt.toISOString(),
          inactivityExpiresAt: s.expiresAt.toISOString(),
          current: s.id === row.refreshId,
        })),
        limit: 100,
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
