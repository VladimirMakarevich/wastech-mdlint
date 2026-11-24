// Copying text for the page's copy buttons. The asynchronous Clipboard API is available only in a
// secure context, which a viewer bound to a LAN address with `--host` is not (plain http on a
// non-loopback address), so a selected, off-screen textarea and the older copy command stand in
// there. Either way the caller learns whether the text actually reached the clipboard, so a button
// never claims "Copied" when it was not.

export async function copyText(text: string): Promise<boolean> {
  // The asynchronous clipboard exists exactly in a secure context, so that is the one check needed.
  if (window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // A denied permission or an unfocused document; the fallback may still work.
    }
  }
  return copyThroughSelection(text);
}

function copyThroughSelection(text: string): boolean {
  const previous = document.activeElement;
  const area = document.createElement("textarea");
  area.value = text;
  area.readOnly = true;
  // Off screen and out of the layout, so selecting it scrolls nothing and moves nothing.
  area.style.position = "fixed";
  area.style.top = "0";
  area.style.left = "-9999px";
  document.body.append(area);
  area.select();
  let copied = false;
  try {
    // eslint-disable-next-line @typescript-eslint/no-deprecated -- the one way to copy an insecure context has: navigator.clipboard does not exist there
    copied = document.execCommand("copy");
  } catch {
    copied = false;
  }
  area.remove();
  if (previous instanceof HTMLElement) {
    previous.focus();
  }
  return copied;
}
