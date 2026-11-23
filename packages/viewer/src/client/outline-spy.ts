// Marks the section being read in the rail's "On this page" outline as the page scrolls, so on a long
// document the outline also says where in it the reader is. The section is the one whose heading was
// passed last: the last heading above a line a little under the header, where a jump to a heading
// lands it. Measured on scroll, once a frame, rather than with an IntersectionObserver, which reports
// headings entering and leaving a band and so loses track when a long section has none in view.

export function initOutlineSpy(): void {
  const links = [
    ...document.querySelectorAll<HTMLAnchorElement>('.outline a[href^="#"]'),
  ];
  const sections = links.flatMap((link) => {
    const heading = document.getElementById(
      decodeURIComponent(link.hash.slice(1)),
    );
    return heading === null ? [] : [{ link, heading }];
  });
  if (sections.length === 0) {
    return;
  }

  let current: HTMLAnchorElement | undefined;
  const mark = (link: HTMLAnchorElement | undefined): void => {
    if (link === current) {
      return;
    }
    current?.removeAttribute("aria-current");
    link?.setAttribute("aria-current", "location");
    current = link;
  };

  const update = (): void => {
    // The line a jump to a heading puts it on: the page's own scroll padding, under the sticky header.
    const line =
      (parseFloat(
        getComputedStyle(document.documentElement).scrollPaddingTop,
      ) || 0) + 8;
    const atBottom =
      window.innerHeight + window.scrollY >=
      document.documentElement.scrollHeight - 2;
    // At the very bottom the last sections may be too short ever to reach the line; the reader has
    // still read to them.
    if (atBottom) {
      mark(sections.at(-1)!.link);
      return;
    }
    let passed: HTMLAnchorElement | undefined;
    for (const { link, heading } of sections) {
      if (heading.getBoundingClientRect().top > line) {
        break;
      }
      passed = link;
    }
    mark(passed);
  };

  let scheduled = false;
  const schedule = (): void => {
    if (scheduled) {
      return;
    }
    scheduled = true;
    requestAnimationFrame(() => {
      scheduled = false;
      update();
    });
  };
  window.addEventListener("scroll", schedule, { passive: true });
  window.addEventListener("resize", schedule);
  update();
}
