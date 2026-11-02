import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import type { ActivityEntry } from "@/lib/board";
import { ActivityLog } from "@/components/card/ActivityLog";

const now = new Date("2026-06-15T12:00:00Z");
const at = (minutesAgo: number) => new Date(now.getTime() - minutesAgo * 60_000).toISOString();

const entries: ActivityEntry[] = [
  { id: "1", at: at(1), type: "checklistDone", to: "Pack" },
  { id: "2", at: at(2), type: "restored" },
  { id: "3", at: at(3), type: "archived" },
  { id: "4", at: at(4), type: "dueDate", to: "2030-10-30" },
  { id: "5", at: at(5), type: "dueDate", from: "2030-10-30" },
  { id: "6", at: at(6), type: "priority", from: "medium", to: "high" },
  { id: "7", at: at(7), type: "description" },
  { id: "8", at: at(8), type: "title", from: "A", to: "B" },
  { id: "9", at: at(9), type: "moved", from: "todo", to: "doing" },
  { id: "10", at: at(10), type: "created" },
];

describe("<ActivityLog />", () => {
  it("lists every entry type as a sentence, in the given (newest first) order", () => {
    render(<ActivityLog activity={entries} now={now} />);
    const items = within(screen.getByRole("list", { name: "Activity" })).getAllByRole("listitem");
    expect(items.map((li) => li.querySelector("span")?.textContent)).toEqual([
      "Completed checklist item “Pack”",
      "Restored",
      "Archived",
      expect.stringMatching(/^Due date set to /),
      "Due date cleared",
      "Priority changed from Medium to High",
      "Description changed",
      "Title changed from “A” to “B”",
      "Moved from To do to Doing",
      "Created",
    ]);
  });

  it("shows a relative time with a datetime and an exact title", () => {
    render(<ActivityLog activity={[entries[0]]} now={now} />);
    const time = screen.getByText("1 minute ago");
    expect(time.tagName).toBe("TIME");
    expect(time).toHaveAttribute("datetime", entries[0].at);
    expect(time).toHaveAttribute("title");
    expect(time).toHaveAttribute("tabindex", "0");
  });

  it("shows a placeholder without activity", () => {
    render(<ActivityLog activity={undefined} />);
    expect(screen.getByText("No activity yet")).toBeInTheDocument();
    expect(screen.queryByRole("list", { name: "Activity" })).not.toBeInTheDocument();
  });
});
