import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { SelectField, TextAreaField, TextField } from "./FormField.js";

describe("form fields", () => {
  it("associates a text field error with its label and input", () => {
    const markup = renderToStaticMarkup(
      <TextField id="email" label="Email" error="Ingresá un email válido" />,
    );

    expect(markup).toContain("for=\"email\"");
    expect(markup).toContain("aria-invalid=\"true\"");
    expect(markup).toContain("aria-describedby=\"email-error\"");
    expect(markup).toContain("Ingresá un email válido");
  });

  it("keeps select and textarea controls disabled when the form is unavailable", () => {
    const markup = renderToStaticMarkup(
      <>
        <SelectField id="trip" label="Viaje" disabled>
          <option>Patagonia</option>
        </SelectField>
        <TextAreaField id="notes" label="Notas" disabled />
      </>,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(2);
  });

  it("disables every field and exposes a busy state while loading", () => {
    const markup = renderToStaticMarkup(
      <>
        <TextField id="name" label="Nombre" loading />
        <SelectField id="trip" label="Viaje" loading>
          <option>Patagonia</option>
        </SelectField>
        <TextAreaField id="notes" label="Notas" loading />
      </>,
    );

    expect(markup.match(/disabled=""/g)).toHaveLength(3);
    expect(markup.match(/aria-busy="true"/g)).toHaveLength(3);
  });
});
