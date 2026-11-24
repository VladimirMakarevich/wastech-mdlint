// What the dashboard asks the server for when the corpus changes under it, kept apart from the page
// so the choice can be tested without a browser.
//
// A live refresh must ask again for the reader's latest choice, not for the page's own address: that
// changes only once an answer lands, so while a newer filter is on its way it still names the one
// before it, and refreshing it would cancel the newer request and show the old rows under the new
// input. And a choice still waiting out its typing delay is left to run, since it fetches fresh rows
// anyway; replacing it with a refresh would drop the reader's newer filter altogether.
export class DashboardRequests {
  private latest: string;
  private waiting = false;

  constructor(initial: string) {
    this.latest = initial;
  }

  /** A request for `address` is going out now. */
  asked(address: string): void {
    this.latest = address;
    this.waiting = false;
  }

  /** A request is waiting out its delay, and will go out with whatever address it then reads. */
  delayed(): void {
    this.waiting = true;
  }

  /** The address a refresh should ask for, or `undefined` while a request is still waiting to go. */
  refreshAddress(): string | undefined {
    return this.waiting ? undefined : this.latest;
  }
}
