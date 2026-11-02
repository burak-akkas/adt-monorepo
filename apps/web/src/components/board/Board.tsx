"use client";

import { useCallback, useRef, useState, type CSSProperties, type DragEvent } from "react";
import {
  addCard,
  archiveCard,
  archiveList,
  backgroundImageCss,
  boardLabels,
  boardLists,
  boardStats,
  boardView,
  deleteArchived,
  deleteCard,
  duplicateCard,
  filterByLabel,
  filterCards,
  filterOverdue,
  findCard,
  type Card,
  type ColumnId,
  insightsListIds,
  cardDueStatus,
  isFiltering,
  isListCollapsed,
  listCards,
  listOverdueCount,
  moveCard,
  renameCard,
  reorderCard,
  restoreCard,
  setView,
  sortListByTitle,
  toggleListCollapsed,
  undoArchive,
  updateCard,
} from "@/lib/board";
import { cardToText } from "@/lib/cardText";
import { addCardFromTemplate, boardTemplates, saveAsTemplate } from "@/lib/templates";
import { useBackgroundImageOk } from "@/hooks/useBackgroundImageOk";
import { useBoard } from "@/hooks/useBoard";
import { useSummaryCollapsed } from "@/hooks/useSummaryCollapsed";
import { AddCardForm } from "./AddCardForm";
import { ArchivePanel } from "@/components/panels/ArchivePanel";
import { CalendarView } from "@/components/views/CalendarView";
import { CardDialog } from "@/components/card/CardDialog";
import { CARD_DRAG_TYPE, CardItem } from "@/components/card/CardItem";
import { ColumnHeader } from "./ColumnHeader";
import { InsightsPanel } from "@/components/panels/InsightsPanel";
import { LabelFilter } from "@/components/card/LabelFilter";
import { ListsManager } from "./ListsManager";
import { SearchBox } from "./SearchBox";
import { SummaryBar } from "./SummaryBar";
import { TableView } from "@/components/views/TableView";
import { TemplatesPanel } from "@/components/panels/TemplatesPanel";
import { UndoToast } from "./UndoToast";
import { ViewSwitch } from "@/components/views/ViewSwitch";
import { ArchiveIcon, Button, SortIcon } from "@/components/ui";

export function Board() {
  const [board, update] = useBoard();
  const [query, setQuery] = useState("");
  const [openCardId, setOpenCardId] = useState<string | null>(null);
  const [overdueOnly, setOverdueOnly] = useState(false);
  const stats = boardStats(board);
  // The filter lapses by itself once nothing is overdue any more.
  // It is also ignored while the summary is collapsed, since its control is hidden then.
  const [summaryCollapsed, setSummaryCollapsed] = useSummaryCollapsed();
  const showOverdueOnly = overdueOnly && stats.overdue > 0 && !summaryCollapsed;
  const [labelFilter, setLabelFilter] = useState<string | null>(null);
  const labelsInUse = boardLabels(board);
  // Like the overdue filter, the label filter lapses once no card has the label any more.
  const activeLabel =
    labelFilter !== null && labelsInUse.some((l) => l.toLowerCase() === labelFilter.toLowerCase()) ? labelFilter : null;
  const visible = filterByLabel(filterCards(showOverdueOnly ? filterOverdue(board) : board, query), activeLabel);
  const filtering = isFiltering(query) || showOverdueOnly || activeLabel !== null;
  const [dragOver, setDragOver] = useState<ColumnId | null>(null);
  const dragSource = useRef<{ id: string; column: ColumnId } | null>(null);

  const [showArchive, setShowArchive] = useState(false);
  const [showInsights, setShowInsights] = useState(false);
  const insightsButtonRef = useRef<HTMLButtonElement>(null);
  const [showLists, setShowLists] = useState(false);
  const listsButtonRef = useRef<HTMLButtonElement>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const templatesButtonRef = useRef<HTMLButtonElement>(null);
  const templates = boardTemplates(board);
  const lists = boardLists(board);
  const view = boardView(board);
  const { doing: doingId, done: doneId } = insightsListIds(board);

  function closeInsights() {
    setShowInsights(false);
    requestAnimationFrame(() => insightsButtonRef.current?.focus());
  }

  function closeLists() {
    setShowLists(false);
    requestAnimationFrame(() => listsButtonRef.current?.focus());
  }

  function closeTemplates() {
    setShowTemplates(false);
    requestAnimationFrame(() => templatesButtonRef.current?.focus());
  }
  const [undo, setUndo] = useState<{ cards: Card[]; listId: ColumnId; message: string } | null>(null);
  const dismissUndo = useCallback(() => setUndo(null), []);

  function archiveListCards(listId: ColumnId) {
    const cards = listCards(board, listId);
    if (cards.length === 0) {
      return;
    }
    update((b) => archiveList(b, listId));
    const what = listId === doneId ? "done " : "";
    setUndo({ cards, listId, message: `Archived ${cards.length} ${what}${cards.length === 1 ? "card" : "cards"}` });
  }

  function undoLastArchive() {
    if (undo) {
      const { cards, listId } = undo;
      update((b) => undoArchive(b, cards, { listId }));
    }
    setUndo(null);
  }

  // Only our own cards, and only from another column, are valid drops.
  const canDrop = (event: DragEvent<HTMLElement>, column: ColumnId) =>
    Array.from(event.dataTransfer.types).includes(CARD_DRAG_TYPE) &&
    dragSource.current !== null &&
    dragSource.current.column !== column;

  function handleDragOver(event: DragEvent<HTMLElement>, column: ColumnId) {
    if (!canDrop(event, column)) {
      return;
    }
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    setDragOver(column);
  }

  function handleDragLeave(event: DragEvent<HTMLElement>, column: ColumnId) {
    const next = event.relatedTarget;
    if (next instanceof Node && event.currentTarget.contains(next)) {
      return;
    }
    setDragOver((current) => (current === column ? null : current));
  }

  function handleDrop(event: DragEvent<HTMLElement>, column: ColumnId) {
    setDragOver(null);
    if (!canDrop(event, column)) {
      return;
    }
    event.preventDefault();
    dragSource.current = null; // the dragged card unmounts on move, so dragend may never fire
    const id = event.dataTransfer.getData(CARD_DRAG_TYPE);
    if (!id) {
      return;
    }
    update((b) => (findCard(b, id) ? moveCard(b, id, column) : b));
  }

  // Looked up in the unfiltered board so an active search never drops the open dialog.
  const open = openCardId ? findCard(board, openCardId) : undefined;
  const openIndex = open ? listCards(board, open.column).findIndex((c) => c.id === open.card.id) : -1;

  // The card may have changed column (and remounted), so find its title button in the DOM after the commit.
  function closeDialog(focusCardId?: string) {
    setOpenCardId(null);
    requestAnimationFrame(() => {
      const target = focusCardId
        ? document.querySelector<HTMLElement>(`[data-card-id="${focusCardId}"] button.card-title`)
        : document.querySelector<HTMLElement>('input[aria-label="New card title"]');
      target?.focus();
    });
  }

  const background = board.background;
  const imageOk = useBackgroundImageOk(background?.type === "image" ? background.url : undefined);
  const backgroundStyle: CSSProperties | undefined =
    background?.type === "color"
      ? { backgroundColor: background.value }
      : background?.type === "image" && imageOk
        ? { backgroundImage: backgroundImageCss(background.url), backgroundSize: "cover", backgroundPosition: "center" }
        : undefined;
  // Lists and the toolbar get a semi-opaque surface so text stays readable over any background.
  const surface = backgroundStyle ? "bg-white/85 dark:bg-zinc-900/85" : "";

  return (
    <div
      className={`flex flex-col gap-6 ${backgroundStyle ? "rounded-xl p-3" : ""}`}
      style={backgroundStyle}
      data-board-background={backgroundStyle ? background?.type : undefined}
    >
      {openCardId && open && (
        <CardDialog
          key={openCardId}
          card={open.card}
          column={open.column}
          board={board}
          onChecklist={update}
          onSave={(edits) => {
            update((b) => updateCard(b, openCardId, edits));
            closeDialog(openCardId);
          }}
          onDelete={() => {
            update((b) => deleteCard(b, openCardId));
            closeDialog();
          }}
          onDuplicate={() => {
            const id = crypto.randomUUID();
            update((b) => duplicateCard(b, openCardId, { id }));
            setOpenCardId(id);
          }}
          onCopyText={async () => {
            const text = cardToText(open.card);
            try {
              await navigator.clipboard.writeText(text);
              return "copied";
            } catch {
              return { text };
            }
          }}
          onMoveToTop={() => update((b) => reorderCard(b, openCardId, "top"))}
          onMoveToBottom={() => update((b) => reorderCard(b, openCardId, "bottom"))}
          canMoveToTop={openIndex > 0}
          canMoveToBottom={openIndex >= 0 && openIndex < listCards(board, open.column).length - 1}
          onArchive={() => {
            update((b) => archiveCard(b, openCardId));
            closeDialog();
          }}
          onSaveTemplate={() => {
            try {
              const id = crypto.randomUUID();
              const next = saveAsTemplate(board, openCardId, undefined, { id });
              const name = boardTemplates(next).find((t) => t.id === id)?.name ?? "";
              update(() => next);
              return { ok: true, message: `Saved template "${name}".` };
            } catch (error) {
              return { ok: false, message: error instanceof Error ? error.message : "Could not save the template." };
            }
          }}
          onClose={() => closeDialog(openCardId)}
          onUpdateBoard={update}
        />
      )}
      <div className={`flex flex-col gap-6 ${backgroundStyle ? `rounded-xl p-3 ${surface}` : ""}`}>
      <SummaryBar
        stats={stats}
        overdueOnly={showOverdueOnly}
        onToggleOverdue={() => setOverdueOnly(!showOverdueOnly)}
        collapsed={summaryCollapsed}
        onToggleCollapsed={() => {
          if (!summaryCollapsed) setOverdueOnly(false);
          setSummaryCollapsed(!summaryCollapsed);
        }}
      />

      <AddCardForm
        onAdd={(title, listId) => update((b) => addCard(b, title, { listId }))}
        templates={templates}
        lists={lists}
        onAddFromTemplate={(templateId, listId, title) => {
          const id = crypto.randomUUID();
          update((b) => {
            const template = boardTemplates(b).find((t) => t.id === templateId);
            if (!template) {
              return b;
            }
            const added = addCardFromTemplate(b, templateId, listId, { id });
            return title.trim() === template.title ? added : renameCard(added, id, title);
          });
        }}
      />

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="flex-1">
          <SearchBox value={query} onChange={setQuery} />
        </div>
        <LabelFilter labels={labelsInUse} value={activeLabel} onChange={setLabelFilter} />
        <ViewSwitch value={view} onChange={(next) => update((b) => setView(b, next))} />
        <Button
          aria-expanded={showArchive}
          aria-controls="archive-panel"
          onClick={() => setShowArchive((open) => !open)}
          className="bg-surface"
        >
          Archived ({board.archive.length})
        </Button>
        <Button ref={insightsButtonRef} aria-haspopup="dialog" onClick={() => setShowInsights(true)} className="bg-surface">
          Board insights
        </Button>
        <Button ref={listsButtonRef} aria-haspopup="dialog" onClick={() => setShowLists(true)} className="bg-surface">
          Manage lists
        </Button>
        <Button ref={templatesButtonRef} aria-haspopup="dialog" onClick={() => setShowTemplates(true)} className="bg-surface">
          Templates
        </Button>
      </div>
      </div>
      {showLists && <ListsManager board={board} onUpdateBoard={update} onClose={closeLists} />}
      {showTemplates && <TemplatesPanel board={board} onUpdateBoard={update} onClose={closeTemplates} />}
      {showInsights && (
        <InsightsPanel
          board={board}
          onClose={closeInsights}
          onOpenCard={(cardId) => {
            setShowInsights(false);
            setOpenCardId(cardId);
          }}
        />
      )}

      {showArchive && (
        <ArchivePanel
          id="archive-panel"
          cards={board.archive}
          onRestore={(cardId) => update((b) => (b.archive.some((c) => c.id === cardId) ? restoreCard(b, cardId) : b))}
          onDelete={(cardId) => update((b) => (b.archive.some((c) => c.id === cardId) ? deleteArchived(b, cardId) : b))}
        />
      )}

      {undo && <UndoToast message={undo.message} onUndo={undoLastArchive} onDismiss={dismissUndo} />}

      {view === "table" ? (
        <TableView board={visible} onOpen={setOpenCardId} />
      ) : view === "calendar" ? (
        <CalendarView board={visible} onOpen={setOpenCardId} onUpdateBoard={update} />
      ) : (
      <div className="flex flex-col gap-4 md:flex-row md:flex-wrap md:items-start">
        {lists.map(({ id, name: title }) => {
          const cards = listCards(visible, id);
          const collapsed = isListCollapsed(board, id);
          return (
            <section
              key={id}
              aria-labelledby={`column-${id}`}
              // Drag and drop onto a collapsed list is not supported.
              onDragEnter={collapsed ? undefined : (event) => handleDragOver(event, id)}
              onDragOver={collapsed ? undefined : (event) => handleDragOver(event, id)}
              onDragLeave={collapsed ? undefined : (event) => handleDragLeave(event, id)}
              onDrop={collapsed ? undefined : (event) => handleDrop(event, id)}
              className={`flex flex-col gap-3 rounded-xl p-3 ${
                collapsed ? "md:max-w-64 md:flex-none" : "md:min-w-64 md:flex-1 md:basis-64"
              } ${
                dragOver === id && !collapsed
                  ? "bg-indigo-50 ring-2 ring-indigo-500 dark:bg-indigo-950/40"
                  : surface || "bg-surface-muted dark:bg-surface/50"
              }`}
            >
              <ColumnHeader
                id={id}
                title={title}
                total={listCards(board, id).length}
                overdue={listOverdueCount(board, id)}
                limit={board.wipLimits?.[id]}
                collapsed={collapsed}
                role={id === doneId ? "done" : id === doingId ? "doing" : undefined}
                onToggleCollapsed={() => update((b) => toggleListCollapsed(b, id))}
              >
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Sort ${title} by title`}
                  title={`Sort ${title} by title`}
                  disabled={listCards(board, id).length < 2}
                  onClick={() => update((b) => sortListByTitle(b, id))}
                >
                  <SortIcon />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label={`Archive ${id === doneId ? "done" : "all"} cards in ${title}`}
                  title={`Archive ${id === doneId ? "done" : "all"} cards in ${title}`}
                  disabled={listCards(board, id).length === 0}
                  onClick={() => archiveListCards(id)}
                >
                  <ArchiveIcon />
                </Button>
              </ColumnHeader>
              {collapsed ? null : cards.length === 0 ? (
                <p className="px-1 py-4 text-center text-xs text-muted">
                  {filtering ? "No matching cards" : "No cards"}
                </p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {cards.map((card) => (
                    <CardItem
                      key={card.id}
                      card={card}
                      dueStatus={cardDueStatus(board, card, id)}
                      onOpen={() => setOpenCardId(card.id)}
                      onFilterLabel={setLabelFilter}
                      onDragStart={() => {
                        dragSource.current = { id: card.id, column: id };
                      }}
                      onDragEnd={() => {
                        dragSource.current = null;
                        setDragOver(null);
                      }}
                    />
                  ))}
                </ul>
              )}
            </section>
          );
        })}
      </div>
      )}
    </div>
  );
}
