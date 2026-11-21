// Home Assistant's ha-input exposes a string value and delegates validation
// to its native input. It does not expose HTMLInputElement.valueAsNumber.
export interface NumberField extends HTMLElement {
  value: string;
  checkValidity(): boolean;
  reportValidity(): boolean;
}

export function numberField(max: number, required = false): NumberField {
  const input = document.createElement("ha-input") as NumberField;
  input.setAttribute("type", "number");
  input.setAttribute("min", "0");
  input.setAttribute("max", String(max));
  input.setAttribute("step", "0.01");
  input.toggleAttribute("required", required);
  return input;
}
