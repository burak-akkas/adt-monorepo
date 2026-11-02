import { act, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { THEME_KEY } from "@/lib/theme";
import { resetThemeStore } from "@/hooks/useTheme";
import { ThemeToggle } from "@/components/app/ThemeToggle";

type Listener = () => void;

function mockMatchMedia(initialDark: boolean) {
  let matches = initialDark;
  const listeners = new Set<Listener>();
  vi.stubGlobal(
    "matchMedia",
    vi.fn(() => ({
      get matches() {
        return matches;
      },
      addEventListener: (_: string, l: Listener) => listeners.add(l),
      removeEventListener: (_: string, l: Listener) => listeners.delete(l),
    })),
  );
  return (dark: boolean) => {
    matches = dark;
    listeners.forEach((l) => l());
  };
}

const group = () => screen.getByRole("radiogroup", { name: "Theme" });

describe("<ThemeToggle />", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    resetThemeStore();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("offers System, Light and Dark with System selected by default", () => {
    mockMatchMedia(false);
    render(<ThemeToggle />);

    expect(within(group()).getAllByRole("radio")).toHaveLength(3);
    expect(screen.getByRole("radio", { name: "System" })).toBeChecked();
    expect(screen.getByRole("radio", { name: "Light" })).not.toBeChecked();
    expect(screen.getByRole("radio", { name: "Dark" })).not.toBeChecked();
  });

  it("applies and stores Dark immediately", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.click(screen.getByRole("radio", { name: "Dark" }));

    expect(screen.getByRole("radio", { name: "Dark" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("dark");
    expect(localStorage.getItem(THEME_KEY)).toBe("dark");
  });

  it("can be operated with the keyboard", async () => {
    mockMatchMedia(false);
    const user = userEvent.setup();
    render(<ThemeToggle />);

    await user.tab();
    expect(screen.getByRole("radio", { name: "System" })).toHaveFocus();
    await user.keyboard("{ArrowRight}");

    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("restores a stored Light choice even when the OS prefers dark", () => {
    mockMatchMedia(true);
    localStorage.setItem(THEME_KEY, "light");
    render(<ThemeToggle />);

    expect(screen.getByRole("radio", { name: "Light" })).toBeChecked();
    expect(document.documentElement.dataset.theme).toBe("light");
  });

  it("follows OS scheme changes while System is selected", () => {
    const setSystemDark = mockMatchMedia(false);
    render(<ThemeToggle />);
    expect(document.documentElement.dataset.theme).toBe("light");

    act(() => setSystemDark(true));
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
