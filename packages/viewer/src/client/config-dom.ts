// Small element builders the config editor's modules share, so every part of the page names its
// classes and wraps its fields the same way.

export function element<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className !== undefined) {
    node.className = className;
  }
  return node;
}

export function button(text: string, className?: string): HTMLButtonElement {
  const node = element("button", className);
  node.type = "button";
  node.textContent = text;
  return node;
}

export function paragraph(
  text: string,
  className?: string,
): HTMLParagraphElement {
  const node = element("p", className);
  node.textContent = text;
  return node;
}

export function hint(text: string): HTMLElement {
  return paragraph(text, "config-hint");
}

export function section(title: string, description: string): HTMLElement {
  const node = element("section", "config-section");
  const heading = element("h2");
  heading.textContent = title;
  node.append(heading, hint(description));
  return node;
}

export function labelText(label: string, required: boolean): string {
  return required ? `${label} *` : label;
}

export type FieldName = {
  label: string;
  required: boolean;
  description?: string | undefined;
  wrapperTag?: "label" | "div";
};

// A field's name beside its control. The wrapper is a <label> for a single input, so a click on the
// name focuses it; a segmented control is a group of buttons, and a label around it would pass a
// click on the name to its first button, choosing that value, so it is wrapped in a <div> instead
// and named by its own `aria-label`.
export function labelled(control: HTMLElement, name: FieldName): HTMLElement {
  const wrapper = element(name.wrapperTag ?? "label", "config-field");
  const text = element("span", "config-field-name");
  text.textContent = labelText(name.label, name.required);
  wrapper.append(text, control);
  if (name.description !== undefined) {
    wrapper.append(hint(name.description));
  }
  return wrapper;
}
