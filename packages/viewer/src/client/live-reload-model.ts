// The part of the event stream's bookkeeping that needs no browser: which events the server sends,
// and where a stream closed by this page resumes from.

/**
 * Every event name the server's `EventHub` sends: each `broadcast` call's name, and `missed`, which
 * the hub sends itself. The stream listens for all of them only to learn their ids — a page that is
 * hidden closes its stream and reopens it from the last id it holds, so an id it never heard would
 * have the server send that event again, and enough of them would read as more missed than it keeps.
 */
export const SERVER_EVENTS = [
  "change",
  "diagnostics",
  "git",
  "missed",
  "review",
] as const;

// The form the server accepts as an event number; anything else would be ignored there, so it is
// not kept here either.
// The server's event id: its run's tag and the event's number. The tag is what lets a server that
// restarted while this page's stream was closed see that the page's position is from another run.
const EVENT_ID = /^[0-9a-f]{8}\.\d{1,15}$/;

/**
 * The last event this page holds, as the id the server gave it. It starts as the id the page was
 * served with and follows every event received, as a browser's own `Last-Event-ID` does.
 *
 * A browser sends `Last-Event-ID` only when it reconnects a stream by itself; a stream this page
 * closed and opens again is a new `EventSource`, which sends none. So the id goes in the address
 * instead, as the `seen` the server already reads from a page's first connection: the server sends
 * every event after it, or `missed` when they are no longer kept or the server is not the run that
 * gave the id, and nothing that happened while the stream was closed is lost.
 */
export class StreamPosition {
  private seen: string | undefined;

  constructor(served: string | undefined) {
    this.seen =
      served !== undefined && EVENT_ID.test(served) ? served : undefined;
  }

  /** Note the id of an event just received; an event without one leaves the position as it was. */
  receive(id: string): void {
    if (EVENT_ID.test(id)) {
      this.seen = id;
    }
  }

  /**
   * The stream's address from here. Without an id — a page served without one, which has
   * received nothing since — the server sends only what happens from now on.
   */
  get url(): string {
    return this.seen === undefined
      ? "/events"
      : `/events?${new URLSearchParams({ seen: this.seen }).toString()}`;
  }
}
