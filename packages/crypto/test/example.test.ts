import { expect, it } from "vitest";
import * as entry from "../src/index";

it("carga el módulo inicial de @organify/crypto", () => {
  expect(entry).toBeDefined();
});
