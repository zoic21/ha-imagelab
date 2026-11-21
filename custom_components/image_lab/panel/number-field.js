export function numberField(max, required = false) {
    const input = document.createElement("ha-input");
    input.setAttribute("type", "number");
    input.setAttribute("min", "0");
    input.setAttribute("max", String(max));
    input.setAttribute("step", "0.01");
    input.toggleAttribute("required", required);
    return input;
}
