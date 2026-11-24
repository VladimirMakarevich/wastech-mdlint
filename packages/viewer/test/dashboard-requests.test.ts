import { describe, expect, it } from "vitest";

import { DashboardRequests } from "../src/client/dashboard-requests.js";

describe("DashboardRequests", () => {
  it("refreshes the address the page was opened at until the reader asks for another", () => {
    expect(new DashboardRequests("/dashboard").refreshAddress()).toBe(
      "/dashboard",
    );
  });

  // The defect this guards: a refresh asked for the page's own address, which still named the
  // previous filter while the newer one was on its way, cancelling it and showing the old rows.
  it("refreshes the latest address asked for, even before its answer lands", () => {
    const requests = new DashboardRequests("/dashboard");
    requests.delayed();
    requests.asked("/dashboard?q=guide");
    expect(requests.refreshAddress()).toBe("/dashboard?q=guide");
  });

  it("leaves a request still waiting out its delay to run, rather than replace it", () => {
    const requests = new DashboardRequests("/dashboard");
    requests.delayed();
    expect(requests.refreshAddress()).toBeUndefined();
    requests.asked("/dashboard?q=new");
    expect(requests.refreshAddress()).toBe("/dashboard?q=new");
  });
});
