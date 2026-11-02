"use client";

import { useState } from "react";
import { boardLabels, boardLists, cardDueStatus, checklistProgress, formatDueDate, PRIORITIES, type Board } from "@/lib/board";
import {
  filterRows,
  lastActivityAt,
  SORT_COLUMNS,
  sortRows,
  tableRows,
  type SortDir,
  type SortKey,
} from "@/lib/tableView";
import { DueChip } from "@/components/card/DueChip";
import { LabelChip } from "@/components/card/LabelChip";
import { Select } from "@/components/ui";

const priorityLabel = (id: string) => PRIORITIES.find((p) => p.id === id)?.label ?? id;

const formatActivity = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });

// All open cards of `board` (already narrowed by the board's search and filters) in a sortable, filterable table.
export function TableView({ board, onOpen }: { board: Board; onOpen: (cardId: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; dir: SortDir }>({ key: "activity", dir: "desc" });
  const [listId, setListId] = useState("");
  const [label, setLabel] = useState("");
  const lists = boardLists(board);
  const labels = boardLabels(board);
  // A filter lapses once its list or label is gone.
  const activeList = lists.some((l) => l.id === listId) ? listId : "";
  const activeLabel = labels.some((l) => l.toLowerCase() === label.toLowerCase()) ? label : "";
  const rows = sortRows(
    filterRows(tableRows(board), { listId: activeList || undefined, label: activeLabel || undefined }),
    sort.key,
    sort.dir,
  );

  function toggleSort(key: SortKey) {
    setSort((s) => (s.key === key ? { key, dir: s.dir === "asc" ? "desc" : "asc" } : { key, dir: "asc" }));
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Select aria-label="Filter table by list" value={activeList} onChange={(event) => setListId(event.target.value)}>
          <option value="">All lists</option>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
        <Select aria-label="Filter table by label" value={activeLabel} onChange={(event) => setLabel(event.target.value)}>
          <option value="">All labels</option>
          {labels.map((l) => (
            <option key={l} value={l}>
              {l}
            </option>
          ))}
        </Select>
      </div>
      <div className="max-w-full overflow-x-auto rounded-xl border border-field bg-surface">
        <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
          <thead className="bg-surface-muted">
            <tr>
              {SORT_COLUMNS.map(({ key, label: heading }) => {
                const active = sort.key === key;
                return (
                  <th
                    key={key}
                    scope="col"
                    aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : undefined}
                    className="px-3 py-2 font-medium"
                  >
                    <button
                      type="button"
                      onClick={() => toggleSort(key)}
                      className="rounded px-1 py-0.5 font-medium hover:underline focus-visible:outline-2 focus-visible:outline-accent"
                    >
                      {heading}
                      <span aria-hidden="true" className="ml-1 text-muted">
                        {active ? (sort.dir === "asc" ? "▲" : "▼") : ""}
                      </span>
                    </button>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={SORT_COLUMNS.length} className="px-3 py-6 text-center text-muted">
                  No matching cards
                </td>
              </tr>
            ) : (
              rows.map(({ card, listId: rowListId, listName }) => {
                const progress = checklistProgress(card);
                const status = cardDueStatus(board, card, rowListId);
                return (
                  <tr
                    key={card.id}
                    onClick={() => onOpen(card.id)}
                    className="cursor-pointer border-t border-field hover:bg-surface-muted"
                  >
                    <td className="px-3 py-2">
                      <button
                        type="button"
                        onClick={(event) => {
                          event.stopPropagation();
                          onOpen(card.id);
                        }}
                        className="text-left font-medium hover:underline"
                      >
                        {card.title}
                      </button>
                    </td>
                    <td className="px-3 py-2">{listName}</td>
                    <td className="px-3 py-2">{priorityLabel(card.priority)}</td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      {card.dueDate ? formatDueDate(card.dueDate) : ""}
                      {status && (
                        <span className="ml-2 text-xs">
                          <DueChip status={status} />
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {(card.labels ?? []).map((l) => (
                          <LabelChip key={l} label={l} />
                        ))}
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">{progress ? `${progress.done}/${progress.total}` : ""}</td>
                    <td className="px-3 py-2 whitespace-nowrap">{formatActivity(lastActivityAt(card))}</td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
