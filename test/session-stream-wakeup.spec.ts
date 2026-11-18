import { SessionsService } from "../src/sessions/sessions.service";
import { SessionEventsService } from "../src/sessions/session-events.service";

describe("committed event stream wakeups", () => {
  afterEach(() => jest.useRealTimers());
  it("wakes immediately, replays from the last sequence, and detaches after unsubscribe", async () => {
    jest.useFakeTimers();
    const bus = new SessionEventsService();
    const history = jest
      .fn()
      .mockResolvedValueOnce({ events: [], hasMore: false })
      .mockResolvedValue({
        events: [
          {
            id: "e",
            sequence: 1,
            type: "item.updated",
            data: { output: "partial" },
          },
        ],
        hasMore: false,
      });
    const service = Object.assign(Object.create(SessionsService.prototype), {
      liveEvents: bus,
      history,
    }) as SessionsService;
    const seen: unknown[] = [];
    const subscription = service
      .stream("actor", "session", 0, Date.now() + 5000)
      .subscribe((event) => seen.push(event));
    await Promise.resolve();
    await Promise.resolve();
    bus.publish("session", { id: 1, type: "item.updated", data: null });
    await Promise.resolve();
    await Promise.resolve();
    expect(seen).toHaveLength(1);
    expect(history).toHaveBeenLastCalledWith("actor", "session", 0, 100);
    subscription.unsubscribe();
    bus.publish("session", { id: 2, type: "item.updated", data: null });
    await jest.advanceTimersByTimeAsync(1000);
    expect(history).toHaveBeenCalledTimes(2);
  });
});
