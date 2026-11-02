/**
 * The lists used for insights: the chosen list if it is still on the board, else the list named
 * Doing / Done (case-insensitive), else none. Mirrors `insightsListIds` in the web app.
 */
export function insightsListIds(
  board: { doingListId: string | null; doneListId: string | null },
  lists: { id: string; name: string }[],
): { doing?: string; done?: string } {
  const resolve = (chosen: string | null, name: string): string | undefined =>
    (chosen !== null && lists.some((list) => list.id === chosen) ? chosen : undefined) ??
    lists.find((list) => list.name.toLowerCase() === name)?.id;
  return { doing: resolve(board.doingListId, "doing"), done: resolve(board.doneListId, "done") };
}
