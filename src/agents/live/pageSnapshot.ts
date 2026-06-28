import type { Page } from "playwright";
import type { LiveElementSnapshot, LivePageSnapshot } from "../../types.js";

export async function capturePageSnapshot(page: Page, includeScreenshot: boolean): Promise<LivePageSnapshot> {
  const elements = await page.locator("a, button, input, textarea, select, [role='button'], [role='link'], summary").evaluateAll((nodes) =>
    nodes.slice(0, 80).map((node, index) => {
      const element = node as HTMLElement;
      const tagName = element.tagName.toLowerCase();
      const input = element as HTMLInputElement;
      const anchor = element as HTMLAnchorElement;
      const text = normalizeText(element.innerText || element.textContent || input.value || "");
      const label = findLabel(element);
      const type = input.type || element.getAttribute("type") || undefined;
      const role = element.getAttribute("role") || implicitRole(tagName, type);
      const href = anchor.href || undefined;
      const disabled = Boolean((element as HTMLButtonElement).disabled || element.getAttribute("aria-disabled") === "true");
      const rect = element.getBoundingClientRect();
      const visible = rect.width > 0 && rect.height > 0 && getComputedStyle(element).visibility !== "hidden" && getComputedStyle(element).display !== "none";
      const id = `el_${index + 1}`;
      element.setAttribute("data-uxagent-id", id);
      const combined = `${text} ${label ?? ""} ${element.getAttribute("aria-label") ?? ""}`.toLowerCase();

      return {
        id,
        tagName,
        role,
        text,
        label,
        placeholder: input.placeholder || undefined,
        type,
        href,
        visible,
        enabled: !disabled,
        isInput: ["input", "textarea", "select"].includes(tagName),
        isClickable: tagName === "a" || tagName === "button" || role === "button" || role === "link" || tagName === "summary",
        isSubmit: type === "submit" || /submit|send|book|schedule|checkout|pay|purchase|subscribe|sign up|register/i.test(combined),
        isDestructive: /delete|remove|cancel|discard|destroy|pay|purchase|checkout|buy now/i.test(combined),
      } satisfies LiveElementSnapshot;

      function normalizeText(value: string): string {
        return value.replace(/\s+/g, " ").trim().slice(0, 160);
      }

      function findLabel(target: HTMLElement): string | undefined {
        const aria = target.getAttribute("aria-label");
        if (aria) {
          return normalizeText(aria);
        }
        const id = target.getAttribute("id");
        if (id) {
          const labelElement = document.querySelector(`label[for="${CSS.escape(id)}"]`);
          if (labelElement?.textContent) {
            return normalizeText(labelElement.textContent);
          }
        }
        const parentLabel = target.closest("label");
        return parentLabel?.textContent ? normalizeText(parentLabel.textContent) : undefined;
      }

      function implicitRole(tag: string, elementType?: string): string | undefined {
        if (tag === "a") {
          return "link";
        }
        if (tag === "button") {
          return "button";
        }
        if (tag === "input") {
          return elementType === "submit" || elementType === "button" ? "button" : "textbox";
        }
        if (tag === "textarea") {
          return "textbox";
        }
        return undefined;
      }
    }),
  );

  const bodyTextSample = await page
    .locator("body")
    .innerText({ timeout: 2000 })
    .then((text) => text.replace(/\s+/g, " ").trim().slice(0, 1200))
    .catch(() => "");

  const screenshotDataUrl = includeScreenshot
    ? `data:image/png;base64,${(await page.screenshot({ fullPage: false, type: "png" })).toString("base64")}`
    : undefined;

  return {
    url: page.url(),
    title: await page.title().catch(() => ""),
    bodyTextSample,
    screenshotDataUrl,
    elements: elements.filter((element) => element.visible),
  };
}
