import {
  All,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Req,
  Res,
  NotFoundException,
  ServiceUnavailableException,
} from "@nestjs/common";
import {
  ApiExcludeEndpoint,
  ApiOperation,
  ApiOkResponse,
  ApiProperty,
  ApiTags,
  ApiNoContentResponse,
} from "@nestjs/swagger";
import type { Request, Response } from "express";
import { LoginDto } from "../auth/auth.dto";
import { BrowserSessionService } from "./browser-session.service";
import {
  ApiAuthenticationErrors,
  ApiValidationErrors,
  ApiResourceErrors,
} from "../openapi/api-docs";

export class BrowserUserDto {
  @ApiProperty() id!: string;
  @ApiProperty() workspaceId!: string;
  @ApiProperty() displayName!: string;
}
export class BrowserSessionResponseDto {
  @ApiProperty({
    description: "Discriminator; false has no user or permissions.",
  })
  authenticated!: boolean;
  @ApiProperty({
    description: "Generation-bound synchronizer token; keep in memory only.",
  })
  csrfToken!: string;
  @ApiProperty({ required: false, format: "date-time" }) csrfExpiresAt?: string;
  @ApiProperty({
    required: false,
    type: BrowserUserDto,
  })
  user?: { id: string; workspaceId: string; displayName: string };
  @ApiProperty({ required: false, type: [String] }) permissions?: string[];
  @ApiProperty({ required: false, format: "date-time" }) idleExpiresAt?: string;
  @ApiProperty({ required: false, format: "date-time" })
  absoluteExpiresAt?: string;
}

const id =
  "[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}";
const reads = new RegExp(
  `^(?:users/me|authorization/me|projects(?:/${id})?|tasks(?:/${id})?|sessions(?:/model-catalog|/projects/${id}/execution-context|/${id}(?:/events(?:/stream)?|/turns/by-request/${id})?)?)$`,
);
const writes = new RegExp(
  `^sessions(?:/directory-preflight|/${id}/(?:turns|interrupt))?$`,
);
export function browserProxyAllowed(method: string, path: string) {
  if (method === "POST" && path === "sessions/creations") return true;
  if (method === "POST" && path === "projects/creation-submissions")
    return true;
  if (
    method === "GET" &&
    new RegExp(
      `^(?:projects/creation-submissions/${id}|departments|configuration-templates(?:/${id})?)$`,
    ).test(path)
  )
    return true;
  if (
    method === "GET" &&
    new RegExp(`^sessions/(?:creations/${id}|${id}/(?:archive|turns))$`).test(
      path,
    )
  )
    return true;
  if (path === "users/me/model-preferences")
    return method === "GET" || method === "PUT";
  if (
    method === "GET" &&
    new RegExp(
      `^projects/${id}/(?:shared-tasks|tasks/${id}/shared-(?:content|comments|history))$`,
    ).test(path)
  )
    return true;
  return method === "GET"
    ? reads.test(path)
    : method === "POST" && writes.test(path);
}

@Controller("browser")
@ApiTags("Browser sessions")
@ApiAuthenticationErrors()
@ApiResourceErrors()
export class BrowserSessionController {
  constructor(private readonly sessions: BrowserSessionService) {}

  @Get("session")
  @ApiOperation({
    summary: "Bootstrap an opaque browser session",
    description:
      "Same-origin only, no-store. Anonymous session lasts ten minutes. Never returns access/refresh tokens. Requires the explicitly enabled browser-session service.",
  })
  @ApiOkResponse({ type: BrowserSessionResponseDto })
  bootstrap(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    res.setHeader("Cache-Control", "no-store");
    return this.sessions.bootstrap(req, res);
  }

  @Post("login")
  @HttpCode(200)
  @ApiOperation({
    summary: "Sign into the current browser",
    description:
      "Exact configured Origin, JSON and X-CSRF-Token from anonymous bootstrap required. Rotates cookie and CSRF. No write replay. Existing bearer login remains separate.",
  })
  @ApiOkResponse({ type: BrowserSessionResponseDto })
  @ApiValidationErrors()
  login(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() dto: LoginDto,
  ) {
    res.setHeader("Cache-Control", "no-store");
    return this.sessions.login(req, res, dto);
  }

  @Post("logout")
  @HttpCode(204)
  @ApiNoContentResponse({
    description:
      "Browser logout committed and cookie cleared; no response body.",
  })
  @ApiOperation({
    summary: "Sign out only this browser",
    description:
      "Exact Origin, JSON and current CSRF required. Revokes only this browser record and its bound refresh row, then clears its cookie. Does not interrupt accepted coding runs or revoke other bearer clients.",
  })
  async logout(
    @Req() req: Request,
    @Res({ passthrough: true }) res: Response,
    @Body() body: Record<string, unknown>,
  ) {
    if (Object.keys(body ?? {}).length) throw new NotFoundException();
    res.setHeader("Cache-Control", "no-store");
    await this.sessions.logout(req, res);
  }

  // Original routes own their DTOs, OpenAPI schemas and resource authorization.
  @All("api/{*path}")
  @ApiExcludeEndpoint()
  async proxy(@Req() req: Request, @Res() res: Response) {
    res.setHeader("Cache-Control", "no-store");
    const prefix = "/api/v1/browser/api/";
    const original = req.originalUrl.split("?")[0] ?? "";
    const path = original.startsWith(prefix)
      ? original.slice(prefix.length)
      : "";
    if (!browserProxyAllowed(req.method, path)) throw new NotFoundException();
    const streaming = path.endsWith("/stream");
    const identity = await this.sessions.authorize(req, req.method !== "GET");
    const stop = new AbortController();
    res.on("close", () => stop.abort());
    const deadline = setTimeout(
      () => stop.abort(),
      streaming ? Math.max(1, identity.deadline - Date.now()) : 30_000,
    );
    let checking = false;
    const fence = streaming
      ? setInterval(() => {
          if (checking) return;
          checking = true;
          // No activity extension; original SSE route also rechecks current grants.
          void this.sessions
            .authorize(req, false)
            .catch(() => stop.abort())
            .finally(() => {
              checking = false;
            });
        }, 5000)
      : undefined;
    let lastUpstreamData = Date.now();
    const heartbeat = streaming
      ? setInterval(() => {
          if (Date.now() - lastUpstreamData > 75_000) {
            stop.abort();
            return;
          }
          if (res.headersSent && !res.destroyed)
            res.write(": browser keepalive\n\n");
        }, 15_000)
      : undefined;
    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${identity.accessToken}`,
        Accept: streaming ? "text/event-stream" : "application/json",
      };
      for (const key of ["if-match", "last-event-id"]) {
        const value = req.headers[key];
        if (typeof value === "string" && value.length < 1024)
          headers[key] = value;
      }
      if (req.method !== "GET") headers["Content-Type"] = "application/json";
      const query = req.originalUrl.includes("?")
        ? req.originalUrl.slice(req.originalUrl.indexOf("?"))
        : "";
      // Socket local port is server-owned. Browser input cannot choose an upstream.
      const upstream = await fetch(
        `http://127.0.0.1:${req.socket.localPort}/api/v1/${path}${query}`,
        {
          method: req.method,
          headers,
          redirect: "error",
          signal: stop.signal,
          ...(req.method !== "GET"
            ? { body: JSON.stringify(req.body ?? {}) }
            : {}),
        },
      );
      res.status(upstream.status);
      for (const key of ["content-type", "retry-after", "etag"]) {
        const value = upstream.headers.get(key);
        if (value) res.setHeader(key, value);
      }
      if (streaming && upstream.ok) {
        res.setHeader("X-Accel-Buffering", "no");
        res.flushHeaders();
      }
      if (upstream.body) {
        const reader = upstream.body.getReader();
        try {
          while (!stop.signal.aborted) {
            const { done, value } = await reader.read();
            if (done) break;
            lastUpstreamData = Date.now();
            if (!res.write(Buffer.from(value)))
              await new Promise<void>((resolve) => {
                const finish = () => {
                  res.off("drain", finish);
                  res.off("close", finish);
                  resolve();
                };
                res.once("drain", finish);
                res.once("close", finish);
              });
          }
        } finally {
          await reader.cancel().catch(() => {});
          reader.releaseLock();
        }
      }
      res.end();
    } catch {
      if (res.headersSent) res.destroy();
      else
        throw new ServiceUnavailableException(
          "Browser upstream is unavailable",
        );
    } finally {
      clearTimeout(deadline);
      if (fence) clearInterval(fence);
      if (heartbeat) clearInterval(heartbeat);
    }
  }
}
