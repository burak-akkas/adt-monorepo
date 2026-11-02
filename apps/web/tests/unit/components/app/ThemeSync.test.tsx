import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { THEME_KEY } from "@/lib/theme";
import { resetThemeStore } from "@/hooks/useTheme";
import { ThemeSync } from "@/components/app/ThemeSync";

describe("<ThemeSync />", () => {
  beforeEach(() => {
    localStorage.clear();
    delete document.documentElement.dataset.theme;
    resetThemeStore();
  });

  it("applies the saved theme without rendering anything", () => {
    localStorage.setItem(THEME_KEY, "dark");
    const { container } = render(<ThemeSync />);
    expect(container).toBeEmptyDOMElement();
    expect(document.documentElement.dataset.theme).toBe("dark");
  });
});
