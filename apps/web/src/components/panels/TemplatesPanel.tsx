"use client";

import { useId, useState, type FormEvent, type KeyboardEvent } from "react";
import type { Board, CardTemplate } from "@/lib/board";
import {
  boardTemplates,
  deleteTemplate,
  MAX_TEMPLATE_NAME_LENGTH,
  renameTemplate,
  validateTemplateName,
} from "@/lib/templates";
import { Button, ConfirmDialog, Dialog, Input } from "@/components/ui";

function TemplateRow({
  template,
  templates,
  onUpdateBoard,
}: {
  template: CardTemplate;
  templates: readonly CardTemplate[];
  onUpdateBoard: (change: (board: Board) => Board) => void;
}) {
  const id = useId();
  const [name, setName] = useState(template.name);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  function rename(event: FormEvent) {
    event.preventDefault();
    const result = validateTemplateName(name, templates, template.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setName(result.name);
    onUpdateBoard((b) => (boardTemplates(b).some((t) => t.id === template.id) ? renameTemplate(b, template.id, result.name) : b));
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // Escape cancels a pending edit; preventing the default keeps the dialog open. Without an edit it closes the panel.
    if (event.key === "Escape" && (name !== template.name || error)) {
      event.preventDefault();
      setName(template.name);
      setError(null);
    }
  }

  function remove() {
    onUpdateBoard((b) => (boardTemplates(b).some((t) => t.id === template.id) ? deleteTemplate(b, template.id) : b));
  }

  return (
    <li className="flex flex-col gap-2 rounded-lg border border-line p-3 dark:border-field">
      <form onSubmit={rename} className="flex flex-wrap items-center gap-2" noValidate>
        <Input
          aria-label={`Name of template "${template.name}"`}
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? `${id}-error` : undefined}
          value={name}
          maxLength={MAX_TEMPLATE_NAME_LENGTH * 2}
          onChange={(event) => setName(event.target.value)}
          onKeyDown={handleKeyDown}
          className="min-w-0 flex-1"
        />
        <Button type="submit" size="sm" aria-label={`Rename template "${template.name}"`}>
          Rename
        </Button>
        <Button type="button" size="sm" variant="danger" aria-label={`Delete template "${template.name}"`} onClick={() => setConfirming(true)}>
          Delete
        </Button>
      </form>
      {confirming && (
        <ConfirmDialog
          title="Delete template"
          message={`Delete the template "${template.name}"?`}
          confirmLabel="Delete"
          onConfirm={remove}
          onCancel={() => setConfirming(false)}
        />
      )}
      {error && (
        <p id={`${id}-error`} role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <p className="break-words text-xs text-muted">Card title: {template.title}</p>
    </li>
  );
}

export function TemplatesPanel({
  board,
  onUpdateBoard,
  onClose,
}: {
  board: Board;
  onUpdateBoard: (change: (board: Board) => Board) => void;
  onClose: () => void;
}) {
  const headingId = useId();
  const templates = boardTemplates(board);

  return (
    <Dialog labelledBy={headingId} onRequestClose={onClose}>
      <div className="flex flex-col gap-4 p-5">
        <h2 id={headingId} className="text-lg font-semibold">
          Templates
        </h2>
        {templates.length === 0 ? (
          <p className="text-sm text-muted">
            No templates yet. Open a card and choose &ldquo;Save as template&rdquo; to create one.
          </p>
        ) : (
          <ul aria-label="Templates" className="flex flex-col gap-2">
            {templates.map((template) => (
              <TemplateRow
                // The name is part of the key so a renamed template resets its edit field.
                key={`${template.id}:${template.name}`}
                template={template}
                templates={templates}
                onUpdateBoard={onUpdateBoard}
              />
            ))}
          </ul>
        )}
        <div className="flex">
          <Button variant="primary" size="sm" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
