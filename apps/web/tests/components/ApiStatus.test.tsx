import { render, screen } from "@testing-library/react";
import { ApiStatus } from "@/components/ApiStatus";

function answer(status: number, body: unknown) {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status })));
}

afterEach(() => vi.unstubAllGlobals());

describe("ApiStatus", () => {
  it("shows that everything is up when the API says so", async () => {
    answer(200, { status: "ok", commit: "abc", database: "ok" });
    render(<ApiStatus />);
    expect(await screen.findByText("API and database are up")).toBeInTheDocument();
  });

  it("shows that something is down when the database is", async () => {
    answer(503, { status: "error", commit: "abc", database: "error" });
    render(<ApiStatus />);
    expect(await screen.findByText("The API or the database is down")).toBeInTheDocument();
  });

  it("shows that something is down when the API can't be reached", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    render(<ApiStatus />);
    expect(await screen.findByText("The API or the database is down")).toBeInTheDocument();
  });
});
