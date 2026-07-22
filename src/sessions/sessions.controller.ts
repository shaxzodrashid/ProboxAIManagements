import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Sse,
  UseGuards,
} from "@nestjs/common";
import { UserRole } from "@prisma/client";
import { map, Observable } from "rxjs";
import { CreateSessionDto, CreateTurnDto } from "./dto";
import { SessionsService } from "./sessions.service";
import { SessionEventsService } from "./session-events.service";
import { JwtAuthGuard, RolesGuard } from "../auth/auth.guards";
import { CurrentUser, Roles } from "../auth/auth.decorator";
import { AuthenticatedUser } from "../auth/auth.types";

@Controller("sessions")
@UseGuards(JwtAuthGuard, RolesGuard)
export class SessionsController {
  constructor(
    private readonly sessions: SessionsService,
    private readonly events: SessionEventsService,
  ) {}
  @Post() @Roles(UserRole.MANAGER) create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateSessionDto,
  ) {
    return this.sessions.create(user.id, dto);
  }
  @Get(":id") get(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.sessions.get(user.id, id);
  }
  @Post(":id/turns") @Roles(UserRole.MANAGER) turn(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
    @Body() dto: CreateTurnDto,
  ) {
    return this.sessions
      .get(user.id, id)
      .then(() => this.sessions.startTurn(id, dto.prompt));
  }
  @Post(":id/interrupt") @Roles(UserRole.MANAGER) interrupt(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ) {
    return this.sessions.interrupt(user.id, id);
  }
  @Sse(":id/events/stream") stream(
    @CurrentUser() user: AuthenticatedUser,
    @Param("id") id: string,
  ): Observable<MessageEvent> {
    return this.events.stream(id).pipe(
      map(
        (event) =>
          ({
            id: String(event.id),
            type: event.type,
            data: { ...(event.data as object), actor: user.id },
          }) as unknown as MessageEvent,
      ),
    );
  }
}
