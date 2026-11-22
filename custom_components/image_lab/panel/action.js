export function actionLabel(button, label, icon) {
    const current = button.firstElementChild;
    if (current?.localName === "ha-icon" &&
        current.getAttribute("icon") === `mdi:${icon}` &&
        button.textContent === label)
        return;
    const glyph = document.createElement("ha-icon");
    glyph.setAttribute("slot", "start");
    glyph.setAttribute("icon", `mdi:${icon}`);
    glyph.setAttribute("aria-hidden", "true");
    button.replaceChildren(glyph, document.createTextNode(label));
}
