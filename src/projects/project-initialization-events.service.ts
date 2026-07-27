import { Injectable } from "@nestjs/common";
import { Observable, Subject, concat, filter, from, map } from "rxjs";

export type InitializationEventMessage = {
  id: number;
  initializationId: string;
  type: string;
  data: Record<string, unknown>;
};

@Injectable()
export class ProjectInitializationEventsService {
  private readonly subjects = new Map<
    string,
    Subject<InitializationEventMessage>
  >();

  publish(event: InitializationEventMessage) {
    this.subject(event.initializationId).next(event);
  }

  stream(
    initializationId: string,
    replay: InitializationEventMessage[],
    after = 0,
  ): Observable<MessageEvent> {
    const cutoff = replay.at(-1)?.id ?? after;
    const live = this.subject(initializationId).pipe(
      filter((event) => event.id > cutoff),
    );
    return concat(from(replay), live).pipe(
      map(
        (event) =>
          ({
            id: String(event.id),
            type: event.type,
            data: event.data,
          }) as unknown as MessageEvent,
      ),
    );
  }

  private subject(initializationId: string) {
    let subject = this.subjects.get(initializationId);
    if (!subject) {
      subject = new Subject<InitializationEventMessage>();
      this.subjects.set(initializationId, subject);
    }
    return subject;
  }
}
