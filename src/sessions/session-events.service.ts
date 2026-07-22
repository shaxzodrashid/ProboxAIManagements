import { Injectable } from "@nestjs/common";
import { Observable, Subject } from "rxjs";

export interface LiveSessionEvent {
  id: number;
  type: string;
  data: unknown;
}

@Injectable()
export class SessionEventsService {
  private readonly channels = new Map<string, Subject<LiveSessionEvent>>();
  stream(sessionId: string): Observable<LiveSessionEvent> {
    return this.channel(sessionId).asObservable();
  }
  publish(sessionId: string, event: LiveSessionEvent) {
    this.channel(sessionId).next(event);
  }
  private channel(sessionId: string) {
    let subject = this.channels.get(sessionId);
    if (!subject) {
      subject = new Subject<LiveSessionEvent>();
      this.channels.set(sessionId, subject);
    }
    return subject;
  }
}
