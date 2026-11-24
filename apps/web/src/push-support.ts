// Detección de plataforma sin efectos secundarios, para poder probarla.

export type PushAvailability =
  "native" | "unsupported" | "install-required" | "available";

export function isIosDevice(userAgent: string, maxTouchPoints: number) {
  return (
    /iPad|iPhone|iPod/.test(userAgent) ||
    // iPadOS se identifica como Mac de escritorio.
    (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  );
}

export function isStandalone() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as Navigator & { standalone?: boolean }).standalone === true
  );
}

export function detectPushAvailability(environment: {
  native: boolean;
  ios: boolean;
  standalone: boolean;
  push: boolean;
}): PushAvailability {
  if (environment.native) return "native";
  // iOS y iPadOS solo admiten push en apps añadidas a la pantalla de inicio.
  if (environment.ios && !environment.standalone) return "install-required";
  return environment.push ? "available" : "unsupported";
}
