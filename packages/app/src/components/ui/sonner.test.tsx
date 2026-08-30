import { describe, expect, it } from "vitest";
import { renderWithProviders } from "../../test/render";
import { Toaster } from "./sonner";

describe("Toaster", () => {
  it("exposes the data-toast-root theme hook", () => {
    renderWithProviders(<Toaster />);
    expect(document.querySelector("[data-toast-root]")).not.toBeNull();
  });
});
