import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

export type ThemeMode = "light" | "dark" | "system";

const STORAGE_KEY = "bongo-theme";

interface ThemeContextValue {
  mode: ThemeMode;
  /** What's actually applied right now - resolves "system" to whichever
   * of light/dark the OS currently prefers. */
  resolvedMode: "light" | "dark";
  setMode: (mode: ThemeMode) => void;
}

// Default is "dark", not "system" - this app has always been dark-only
// until now, so an existing user with no stored preference should see
// exactly what they've always seen, not suddenly flip to light because
// their OS happens to be in light mode. Only users who explicitly pick
// "system" opt into following it.
const ThemeContext = createContext<ThemeContextValue>({
  mode: "dark",
  resolvedMode: "dark",
  setMode: () => {},
});

function resolveMode(mode: ThemeMode): "light" | "dark" {
  if (mode === "system") {
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
  }
  return mode;
}

function applyMode(resolved: "light" | "dark") {
  document.documentElement.classList.toggle("light", resolved === "light");
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", resolved === "light" ? "#f3f4f6" : "#0b0e12");
}

function readStoredMode(): ThemeMode {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === "light" || stored === "dark" || stored === "system") return stored;
  } catch {
    // localStorage unavailable (private browsing, etc.) - fall through to default
  }
  return "dark";
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [mode, setModeState] = useState<ThemeMode>(readStoredMode);
  const [resolvedMode, setResolvedMode] = useState<"light" | "dark">(() => resolveMode(mode));

  const setMode = (next: ThemeMode) => {
    setModeState(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Best effort - the choice just won't survive a reload if storage is unavailable.
    }
  };

  useEffect(() => {
    const resolved = resolveMode(mode);
    setResolvedMode(resolved);
    applyMode(resolved);

    if (mode !== "system") return undefined;

    // Live-track OS preference changes while "system" is selected, rather
    // than only resolving it once at selection time.
    const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
    const handleChange = () => {
      const next = resolveMode("system");
      setResolvedMode(next);
      applyMode(next);
    };
    mediaQuery.addEventListener("change", handleChange);
    return () => mediaQuery.removeEventListener("change", handleChange);
  }, [mode]);

  return <ThemeContext.Provider value={{ mode, resolvedMode, setMode }}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  return useContext(ThemeContext);
}
