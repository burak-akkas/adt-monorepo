import { describe, expect, it } from "vitest";
import type { ActivityEntry, Board, Card, ColumnId } from "@/lib/board";
import { emptyBoard } from "@/lib/board";
import {
  cycleTimes,
  dailyWip,
  formatDuration,
  overdueCards,
  summarizeCycleTimes,
  weeklyThroughput,
} from "@/lib/insights";

// Wednesday 2026-10-28 12:00 local.
const NOW = new Date(2026, 9, 28, 12, 0, 0);
const HOUR = 3_600_000;
const DAY = 24 * HOUR;

const local = (m: number, d: number, h = 0, min = 0) => new Date(2026, m - 1, d, h, min).toISOString();

let seq = 0;
function move(at: string, from: ColumnId, to: ColumnId): ActivityEntry {
  seq += 1;
  return { id: `a${seq}`, at, type: "moved", from, to };
}

// `moves` are given oldest first; the card stores them newest first.
function card(id: string, moves: ActivityEntry[] = [], extra: Partial<Card> = {}): Card {
  return {
    id,
    title: id,
    createdAt: local(1, 1),
    priority: "medium",
    activity: [...moves].reverse(),
    ...extra,
  };
}

function board(columns: Partial<Record<ColumnId, Card[]>>, archive: Card[] = []): Board {
  return { ...emptyBoard(), columns: { todo: [], doing: [], done: [], ...columns }, archive };
}

describe("empty board", () => {
  it("gives empty results", () => {
    const b = emptyBoard();
    expect(cycleTimes(b, { now: NOW })).toEqual({ durationsMs: [], excluded: 0 });
    expect(summarizeCycleTimes([])).toBeNull();
    expect(weeklyThroughput(b, { now: NOW })).toHaveLength(8);
    expect(weeklyThroughput(b, { now: NOW }).every((w) => w.count === 0)).toBe(true);
    expect(dailyWip(b, { now: NOW })).toHaveLength(14);
    expect(dailyWip(b, { now: NOW }).every((d) => d.count === 0)).toBe(true);
    expect(overdueCards(b, { now: NOW })).toEqual([]);
  });
});

describe("cycleTimes", () => {
  it("measures a normal card", () => {
    const c = card("a", [move(local(10, 20, 9), "todo", "doing"), move(local(10, 21, 12), "doing", "done")]);
    expect(cycleTimes(board({ done: [c] }), { now: NOW })).toEqual({ durationsMs: [DAY + 3 * HOUR], excluded: 0 });
  });

  it("uses the earliest Doing and the latest Done for a re-opened card", () => {
    const c = card("a", [
      move(local(10, 20, 9), "todo", "doing"),
      move(local(10, 21, 9), "doing", "done"),
      move(local(10, 22, 9), "done", "doing"),
      move(local(10, 23, 9), "doing", "done"),
    ]);
    expect(cycleTimes(board({ done: [c] })).durationsMs).toEqual([3 * DAY]);
  });

  it("excludes finished cards without Doing history", () => {
    const direct = card("a", [move(local(10, 21), "todo", "done")]);
    const created = card("b");
    expect(cycleTimes(board({ done: [direct, created] }))).toEqual({ durationsMs: [], excluded: 2 });
  });

  it("excludes a card whose only Done entry predates its Doing entry", () => {
    const c = card("a", [move(local(10, 20), "todo", "done"), move(local(10, 22), "done", "doing")]);
    expect(cycleTimes(board({ done: [c] }))).toEqual({ durationsMs: [], excluded: 1 });
  });

  it("excludes truncated history (only the Done entry survives)", () => {
    const c = card("a", [move(local(10, 22), "doing", "done")]);
    expect(cycleTimes(board({ done: [c] })).excluded).toBe(1);
  });

  it("neither measures nor excludes open cards", () => {
    const open = card("a", [move(local(10, 20), "todo", "doing")]);
    expect(cycleTimes(board({ todo: [card("t")], doing: [open] }))).toEqual({ durationsMs: [], excluded: 0 });
  });

  it("counts archived cards", () => {
    const c = card("a", [move(local(10, 20, 0), "todo", "doing"), move(local(10, 20, 2), "doing", "done")]);
    expect(cycleTimes(board({}, [c])).durationsMs).toEqual([2 * HOUR]);
  });

  it("keeps same-millisecond moves in their true order", () => {
    const at = local(10, 20, 9);
    const c = card("a", [move(at, "todo", "doing"), move(at, "doing", "done")]);
    expect(cycleTimes(board({ done: [c] }))).toEqual({ durationsMs: [0], excluded: 0 });
  });

  it("ignores moves with an invalid timestamp", () => {
    const c = card("a", [move("nope", "todo", "doing"), move(local(10, 21), "doing", "done")]);
    expect(cycleTimes(board({ done: [c] })).excluded).toBe(1);
  });
});

describe("summarizeCycleTimes", () => {
  it("computes the median and average", () => {
    expect(summarizeCycleTimes([3, 1, 2])).toEqual({ median: 2, average: 2 });
    expect(summarizeCycleTimes([4, 1, 2, 10])).toEqual({ median: 3, average: 4.25 });
  });

  it("does not mutate its input", () => {
    const input = [3, 1, 2];
    summarizeCycleTimes(input);
    expect(input).toEqual([3, 1, 2]);
  });
});

describe("formatDuration", () => {
  it.each([
    [0, "<1m"],
    [59_999, "<1m"],
    [-5, "<1m"],
    [NaN, "<1m"],
    [60_000, "1m"],
    [45 * 60_000, "45m"],
    [HOUR, "1h"],
    [HOUR + 5 * 60_000, "1h 5m"],
    [2 * DAY + 3 * HOUR, "2d 3h"],
    [2 * DAY, "2d"],
    [2 * DAY + 4 * 60_000, "2d"],
    [DAY + 3 * HOUR + 20 * 60_000, "1d 3h"],
  ])("formats %s as %s", (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });
});

describe("weeklyThroughput", () => {
  it("returns 8 Monday-start weeks, oldest first, current week included", () => {
    const weeks = weeklyThroughput(emptyBoard(), { now: NOW });
    expect(weeks).toHaveLength(8);
    expect(weeks[7].weekStart).toBe("2026-10-26");
    expect(weeks[6].weekStart).toBe("2026-10-19");
    expect(weeks[0].weekStart).toBe("2026-09-07");
    expect(weeks[7].label).toBe("Oct 26");
  });

  it("splits Sunday 23:59 and Monday 00:00 into different weeks", () => {
    const sunday = card("a", [move(local(10, 25, 23, 59), "doing", "done")]);
    const monday = card("b", [move(local(10, 26, 0, 0), "doing", "done")]);
    const weeks = weeklyThroughput(board({ done: [sunday, monday] }), { now: NOW });
    expect(weeks[6].count).toBe(1);
    expect(weeks[7].count).toBe(1);
  });

  it("ignores entries older than 8 weeks or after now", () => {
    const old = card("a", [move(local(9, 6, 23, 59), "doing", "done")]);
    const future = card("b", [move(local(10, 29), "doing", "done")]);
    const weeks = weeklyThroughput(board({ done: [old, future] }), { now: NOW });
    expect(weeks.reduce((sum, w) => sum + w.count, 0)).toBe(0);
  });

  it("counts a card once per week, even if finished twice", () => {
    const c = card("a", [
      move(local(10, 26, 9), "doing", "done"),
      move(local(10, 27, 9), "done", "doing"),
      move(local(10, 28, 9), "doing", "done"),
    ]);
    expect(weeklyThroughput(board({ done: [c] }), { now: NOW })[7].count).toBe(1);
  });

  it("counts a card in each week it was finished", () => {
    const c = card("a", [
      move(local(10, 14, 9), "doing", "done"),
      move(local(10, 15, 9), "done", "doing"),
      move(local(10, 28, 9), "doing", "done"),
    ]);
    const weeks = weeklyThroughput(board({ done: [c] }), { now: NOW });
    expect([weeks[6].count, weeks[7].count]).toEqual([0, 1]);
    expect(weeks[5].count).toBe(1);
  });

  it("counts archived cards but not cards without a Done move", () => {
    const archived = card("a", [move(local(10, 27, 9), "doing", "done")]);
    const never = card("b");
    const weeks = weeklyThroughput(board({ done: [never] }, [archived]), { now: NOW });
    expect(weeks[7].count).toBe(1);
  });
});

describe("dailyWip", () => {
  it("returns 14 days, oldest first, ending today", () => {
    const days = dailyWip(emptyBoard(), { now: NOW });
    expect(days).toHaveLength(14);
    expect(days[0].day).toBe("2026-10-15");
    expect(days[13].day).toBe("2026-10-28");
  });

  it("replays moves across a midnight boundary", () => {
    const c = card("a", [move(local(10, 25, 23, 59), "todo", "doing"), move(local(10, 27, 0, 0), "doing", "done")], {
      createdAt: local(10, 1),
    });
    const days = dailyWip(board({ done: [c] }), { now: NOW });
    const byDay = Object.fromEntries(days.map((d) => [d.day, d.count]));
    expect(byDay["2026-10-24"]).toBe(0);
    expect(byDay["2026-10-25"]).toBe(1);
    expect(byDay["2026-10-26"]).toBe(1);
    expect(byDay["2026-10-27"]).toBe(0);
    expect(byDay["2026-10-28"]).toBe(0);
  });

  it("counts a card that has not moved yet in its first column before the first move", () => {
    const c = card("a", [move(local(10, 27, 9), "doing", "todo")], { createdAt: local(10, 1) });
    const days = dailyWip(board({ todo: [c] }), { now: NOW });
    expect(days[0].count).toBe(1);
    expect(days[13].count).toBe(0);
  });

  it("counts a card without history only from today", () => {
    const c = card("a", [], { createdAt: local(10, 1) });
    const days = dailyWip(board({ doing: [c] }), { now: NOW });
    expect(days.map((d) => d.count)).toEqual([...Array(13).fill(0), 1]);
  });

  it("does not count a card created after the day's end", () => {
    const c = card("a", [move(local(10, 28, 9), "todo", "doing")], { createdAt: local(10, 28, 8) });
    const days = dailyWip(board({ doing: [c] }), { now: NOW });
    expect(days[12].count).toBe(0);
    expect(days[13].count).toBe(1);
  });

  it("uses now as the cutoff for today", () => {
    const c = card("a", [move(local(10, 28, 15), "todo", "doing")], { createdAt: local(10, 1) });
    expect(dailyWip(board({ doing: [c] }), { now: NOW })[13].count).toBe(0);
  });

  it("does not count archived cards today but replays their past", () => {
    const c = card("a", [move(local(10, 20, 9), "todo", "doing"), move(local(10, 22, 9), "doing", "done")], {
      createdAt: local(10, 1),
    });
    const byDay = Object.fromEntries(dailyWip(board({}, [c]), { now: NOW }).map((d) => [d.day, d.count]));
    expect(byDay["2026-10-21"]).toBe(1);
    expect(byDay["2026-10-22"]).toBe(0);
    expect(byDay["2026-10-28"]).toBe(0);
  });
});

describe("overdueCards", () => {
  it("returns open cards past due, soonest first, without Done or due-today cards", () => {
    const later = card("later", [], { dueDate: "2026-10-27" });
    const sooner = card("sooner", [], { dueDate: "2026-10-01" });
    const today = card("today", [], { dueDate: "2026-10-28" });
    const doing = card("doing", [], { dueDate: "2026-10-27" });
    const finished = card("finished", [], { dueDate: "2026-10-01" });
    const archived = card("archived", [], { dueDate: "2026-10-01" });
    const result = overdueCards(board({ todo: [later, sooner, today], doing: [doing], done: [finished] }, [archived]), { now: NOW });
    expect(result.map((c) => c.id)).toEqual(["sooner", "later", "doing"]);
  });
});

describe("purity", () => {
  it("never mutates the board", () => {
    const c = card("a", [move(local(10, 20), "todo", "doing"), move(local(10, 22), "doing", "done")], {
      dueDate: "2026-10-01",
    });
    const b = board({ doing: [c], done: [c] }, [c]);
    const before = JSON.stringify(b);
    cycleTimes(b, { now: NOW });
    weeklyThroughput(b, { now: NOW });
    dailyWip(b, { now: NOW });
    overdueCards(b, { now: NOW });
    expect(JSON.stringify(b)).toBe(before);
  });
});
