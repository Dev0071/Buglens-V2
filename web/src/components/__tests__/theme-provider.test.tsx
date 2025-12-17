import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, act } from "@testing-library/react";
import { ThemeProvider, useTheme } from "@/components/theme-provider";

// Test component to access theme context
function TestConsumer() {
  const { theme, setTheme, resolvedTheme } = useTheme();
  return (
    <div>
      <span data-testid="current-theme">{theme}</span>
      <span data-testid="resolved-theme">{resolvedTheme}</span>
      <button onClick={() => setTheme("dark")}>Set Dark</button>
      <button onClick={() => setTheme("light")}>Set Light</button>
      <button onClick={() => setTheme("system")}>Set System</button>
    </div>
  );
}

describe("ThemeProvider", () => {
  beforeEach(() => {
    // Clear localStorage before each test
    localStorage.clear();
    // Reset document classes
    document.documentElement.classList.remove("light", "dark");
  });

  it("renders children correctly", () => {
    render(
      <ThemeProvider>
        <div data-testid="child">Child content</div>
      </ThemeProvider>
    );

    expect(screen.getByTestId("child")).toBeInTheDocument();
  });

  it("uses default theme when no stored preference", () => {
    render(
      <ThemeProvider defaultTheme="light" storageKey="test-theme">
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("light");
  });

  it("loads theme from localStorage", () => {
    localStorage.setItem("test-theme", "dark");

    render(
      <ThemeProvider defaultTheme="light" storageKey="test-theme">
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("dark");
  });

  it("allows changing theme", async () => {
    render(
      <ThemeProvider defaultTheme="light" storageKey="test-theme">
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("light");

    await act(async () => {
      fireEvent.click(screen.getByText("Set Dark"));
    });

    expect(screen.getByTestId("current-theme")).toHaveTextContent("dark");
    expect(localStorage.getItem("test-theme")).toBe("dark");
  });

  it("applies dark class to document when dark theme selected", async () => {
    render(
      <ThemeProvider defaultTheme="dark" storageKey="test-theme">
        <TestConsumer />
      </ThemeProvider>
    );

    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("applies light class to document when light theme selected", async () => {
    render(
      <ThemeProvider defaultTheme="light" storageKey="test-theme">
        <TestConsumer />
      </ThemeProvider>
    );

    expect(document.documentElement.classList.contains("light")).toBe(true);
  });

  it("throws error when useTheme is used outside provider", () => {
    // Suppress console.error for this test
    const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    expect(() => {
      render(<TestConsumer />);
    }).toThrow("useTheme must be used within a ThemeProvider");

    consoleSpy.mockRestore();
  });

  it("respects system preference when theme is system", async () => {
    // Mock matchMedia for dark mode
    const mockMatchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query === "(prefers-color-scheme: dark)",
      media: query,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    }));
    window.matchMedia = mockMatchMedia;

    render(
      <ThemeProvider defaultTheme="system" storageKey="test-theme">
        <TestConsumer />
      </ThemeProvider>
    );

    expect(screen.getByTestId("current-theme")).toHaveTextContent("system");
    expect(screen.getByTestId("resolved-theme")).toHaveTextContent("dark");
  });
});
