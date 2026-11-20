export const themeStorageKey = "organify.theme";

export function readDarkMode() {
  return localStorage.getItem(themeStorageKey) === "dark";
}

export function applyTheme(dark: boolean) {
  document.documentElement.dataset.theme = dark ? "dark" : "light";
  document
    .querySelector('meta[name="theme-color"]')
    ?.setAttribute("content", dark ? "#16141e" : "#f7f7fa");
}
