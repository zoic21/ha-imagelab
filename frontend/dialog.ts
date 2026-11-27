const snapSheet = "ha-snap-bottom-sheet";
const resizableSheet = "ha-resizable-bottom-sheet";
const mobileDialog = "(max-width: 870px), (max-height: 500px)";

type RouteLoader = HTMLElement & { routerOptions?: { routes?: Record<string, { load?: () => Promise<unknown> }> } };
type Sheet = HTMLElement & { dismissable?: boolean; persistent?: boolean };
type Surface = { element: HTMLElement; content: ChildNode[]; sheet?: Sheet };

function registeredSheet() {
  if (customElements.get(snapSheet)) return snapSheet;
  if (customElements.get(resizableSheet)) return resizableSheet;
}

let sheetLoad: Promise<ReturnType<typeof registeredSheet>> | undefined;

function loadSheet(): Promise<ReturnType<typeof registeredSheet>> {
  const registered = registeredSheet();
  if (registered) return Promise.resolve(registered);
  // The native resize gesture is registered by Home Assistant's automation editor.
  return sheetLoad ??= (async () => {
    if (!customElements.get("ha-panel-config")) {
      const app = document.querySelector("home-assistant");
      const main = app?.shadowRoot?.querySelector("home-assistant-main");
      const resolver = main?.shadowRoot?.querySelector<RouteLoader>("partial-panel-resolver");
      await resolver?.routerOptions?.routes?.config?.load?.();
    }
    if (customElements.get("ha-panel-config")) {
      const config = document.createElement("ha-panel-config") as RouteLoader;
      await config.routerOptions?.routes?.automation?.load?.();
    }
    return registeredSheet();
  })().catch(() => undefined).finally(() => { sheetLoad = undefined; });
}

export const dialogStyles = `
  image-lab-dialog:not([hidden]) { display: contents; }
  .image-lab-modal {
    position: fixed; inset: 0; width: 100%; height: 100%; max-width: none; max-height: none;
    padding: 0; margin: 0; border: 0; background: transparent; color: inherit; overflow: visible;
  }
  .image-lab-modal::backdrop { background: var(--ha-bottom-sheet-scrim-color, var(--mdc-dialog-scrim-color, rgb(0 0 0 / .32))); }
  .image-lab-modal > * {
    --ha-bottom-sheet-handle-padding: 0px;
    --ha-bottom-sheet-scrim-color: transparent;
    --ha-bottom-sheet-surface-background: var(--ha-dialog-surface-background, var(--card-background-color));
    --ha-bottom-sheet-inset-left: var(--safe-area-inset-left, 0px);
    --ha-bottom-sheet-inset-right: var(--safe-area-inset-right, 0px);
  }
  .image-lab-sheet {
    display: flex; flex-direction: column; flex: 1; min-height: 0;
    box-sizing: border-box; padding-block: 20px var(--safe-area-inset-bottom, 0px);
  }
  .image-lab-sheet > ha-dialog-header { flex: none; }
  .image-lab-sheet-body {
    flex: 1; min-height: 0; overflow: auto; overscroll-behavior: contain;
    padding: var(--ha-space-4, 16px);
  }
  .image-lab-sheet-footer {
    flex: none; border-top: 1px solid var(--divider-color);
    padding: var(--ha-space-3, 12px) var(--ha-space-4, 16px);
  }
  @media ${mobileDialog} {
    image-lab-dialog > ha-dialog {
      --ha-dialog-width-full: 100vw;
      --ha-dialog-max-width: 100vw;
    }
  }`;

const dialogAttributes = ["header-title", "header-subtitle", "width", "type", "aria-describedby", "prevent-scrim-close"];

// Keep the form and its listeners in the panel's DOM whichever surface displays it.
class ImageLabDialog extends HTMLElement {
  static observedAttributes = ["open", "inert", ...dialogAttributes];
  private request = 0;
  private surface?: Surface;
  private titleElement?: HTMLElement;
  private subtitle?: HTMLElement;

  connectedCallback() {
    this.hidden = true;
    if (this.hasAttribute("open")) void this.show();
  }

  disconnectedCallback() {
    this.request++;
    this.unmount();
  }

  attributeChangedCallback(name: string, before: string | null, value: string | null) {
    if (!this.isConnected || before === value) return;
    if (name !== "open") {
      this.updateSurface();
    } else if (value !== null) {
      if (this.surface) this.surface.element.setAttribute("open", "");
      else void this.show();
    } else {
      this.request++;
      const surface = this.surface;
      if (surface?.sheet) this.finish(surface);
      else surface?.element.removeAttribute("open");
    }
  }

  private async show() {
    const request = ++this.request;
    const tag = matchMedia(mobileDialog).matches ? await loadSheet() : undefined;
    if (!this.isConnected || request !== this.request || !this.hasAttribute("open")) return;
    const content = Array.from(this.childNodes);
    this.hidden = false;
    if (tag) this.showSheet(tag, content);
    else this.showDesktop(content);
  }

  private showDesktop(content: ChildNode[]) {
    const element = document.createElement("ha-dialog");
    const surface = this.surface = { element, content };
    this.updateSurface();
    element.addEventListener("closed", event => {
      if (event.target !== element) return;
      event.stopPropagation();
      this.finish(surface);
    });
    element.append(...content);
    this.append(element);
    element.setAttribute("open", "");
  }

  private showSheet(tag: NonNullable<ReturnType<typeof registeredSheet>>, content: ChildNode[]) {
    const element = document.createElement("dialog");
    element.className = "image-lab-modal";
    if (this.getAttribute("type") === "alert") element.setAttribute("role", "alertdialog");
    const sheet: Sheet = document.createElement(tag);
    const surface = this.surface = { element, sheet, content };
    const frame = document.createElement("div");
    frame.className = "image-lab-sheet";
    const header = document.createElement("ha-dialog-header");
    header.setAttribute("show-border", "");
    const close = document.createElement("ha-icon-button");
    const closeLabel = this.getAttribute("close-label") ?? "Close";
    close.slot = "navigationIcon";
    close.setAttribute("label", closeLabel);
    close.title = closeLabel;
    const icon = document.createElement("ha-icon");
    icon.setAttribute("icon", "mdi:close");
    icon.setAttribute("aria-hidden", "true");
    close.append(icon);
    close.onclick = () => this.removeAttribute("open");
    this.titleElement = document.createElement("span");
    this.titleElement.slot = "title";
    this.subtitle = document.createElement("span");
    this.subtitle.slot = "subtitle";
    header.append(close, this.titleElement, this.subtitle);
    const body = document.createElement("div");
    body.className = "image-lab-sheet-body";
    const footer = document.createElement("div");
    footer.className = "image-lab-sheet-footer";
    for (const node of content) {
      if (node instanceof HTMLElement && node.slot === "header") node.remove();
      else if (node instanceof HTMLElement && node.slot === "footer") footer.append(node);
      else body.append(node);
    }
    // Give scrolling, panning and drawing to the form. Only the handle resizes the sheet.
    frame.addEventListener("touchstart", event => event.stopPropagation(), { passive: true });
    frame.append(header, body);
    if (footer.childElementCount) frame.append(footer);
    sheet.append(frame);
    sheet.addEventListener("bottom-sheet-closed", event => {
      if (event.target === sheet) this.finish(surface);
    });
    element.addEventListener("cancel", event => {
      event.preventDefault();
      if (!this.inert) this.removeAttribute("open");
    });
    this.updateSurface();
    this.append(element);
    // Keep the page behind the native sheet inert, with native focus restoration.
    element.showModal();
    element.append(sheet);
    (frame.querySelector<HTMLElement>("[autofocus]") ?? close).focus({ preventScroll: true });
  }

  private updateSurface() {
    const surface = this.surface;
    if (!surface) return;
    if (surface.sheet) {
      const title = this.getAttribute("header-title") ?? "";
      const subtitle = this.getAttribute("header-subtitle") ?? "";
      this.titleElement!.textContent = title;
      this.subtitle!.textContent = subtitle;
      this.subtitle!.hidden = !subtitle;
      surface.element.setAttribute("aria-label", title);
      const protectedForm = this.inert || this.hasAttribute("prevent-scrim-close");
      surface.sheet.dismissable = !protectedForm;
      surface.sheet.persistent = protectedForm;
      const description = this.getAttribute("aria-describedby");
      if (description === null) surface.element.removeAttribute("aria-describedby");
      else surface.element.setAttribute("aria-describedby", description);
    } else {
      for (const name of dialogAttributes) {
        const value = this.getAttribute(name);
        if (value === null) surface.element.removeAttribute(name);
        else surface.element.setAttribute(name, value);
      }
    }
  }

  private finish(surface: Surface) {
    if (this.surface !== surface) return;
    this.unmount();
    this.removeAttribute("open");
    this.dispatchEvent(new Event("closed"));
  }

  private unmount() {
    const surface = this.surface;
    if (!surface) return;
    this.surface = undefined;
    if (surface.element instanceof HTMLDialogElement) surface.element.close();
    surface.element.remove();
    this.append(...surface.content);
    this.hidden = true;
    this.titleElement = this.subtitle = undefined;
  }
}

if (!customElements.get("image-lab-dialog"))
  customElements.define("image-lab-dialog", ImageLabDialog);

export function createDialog(title: string, closeLabel: string) {
  const dialog = document.createElement("image-lab-dialog");
  dialog.setAttribute("header-title", title);
  dialog.setAttribute("close-label", closeLabel);
  return dialog;
}
