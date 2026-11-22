import { describe, expect, it, vi } from "vitest";
import { isDeleteSwipe } from "./task-swipe";
import { letterKey, remapShortcut } from "./workspace-shortcuts";

vi.mock("./desktop-windows", () => ({ desktopWindow: undefined }));

describe("atajos del espacio de trabajo", () => {
  const defaults = { edit: "e", rename: "r", delete: "d", create: "n" };

  it("libera la asignación anterior cuando una letra cambia de acción", () => {
    expect(remapShortcut(defaults, "delete", "r")).toEqual({
      edit: "e",
      rename: null,
      delete: "r",
      create: "n",
    });
  });

  it("desasigna una tecla sin cambiar las demás", () => {
    expect(remapShortcut(defaults, "create", null)).toEqual({
      ...defaults,
      create: null,
    });
  });

  it("reconoce letras del teclado español y descarta teclas de navegación", () => {
    expect(letterKey("Ñ")).toBe("ñ");
    expect(letterKey("ArrowRight")).toBeUndefined();
  });
});

describe("gesto de borrado", () => {
  it("requiere un desplazamiento suficiente y predominantemente a la derecha", () => {
    expect(isDeleteSwipe(90, -30)).toBe(true);
    expect(isDeleteSwipe(30, 0)).toBe(false);
    expect(isDeleteSwipe(-90, 0)).toBe(false);
    expect(isDeleteSwipe(90, 80)).toBe(false);
  });
});
