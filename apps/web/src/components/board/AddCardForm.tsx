"use client";

import { useState, type FormEvent } from "react";
import { MAX_TITLE_LENGTH, type CardTemplate, type List } from "@/lib/board";
import { Button, Input, Select } from "@/components/ui";

export function AddCardForm({
  onAdd,
  templates = [],
  lists = [],
  onAddFromTemplate,
}: {
  onAdd: (title: string, listId: string) => void;
  // With lists the form offers "Target list"; with at least one template (and a handler) also "From template".
  templates?: readonly CardTemplate[];
  lists?: readonly List[];
  // `title` is the (possibly edited) title field, which replaces the template's title.
  onAddFromTemplate?: (templateId: string, listId: string, title: string) => void;
}) {
  const [title, setTitle] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [listId, setListId] = useState("");

  const withTemplates = templates.length > 0 && lists.length > 0 && onAddFromTemplate !== undefined;
  // A template or list that no longer exists counts as "None" / the first list.
  const template = withTemplates ? templates.find((t) => t.id === templateId) : undefined;
  const targetId = lists.find((l) => l.id === listId)?.id ?? lists[0]?.id ?? "";

  function chooseTemplate(next: string) {
    setTemplateId(next);
    const chosen = templates.find((t) => t.id === next);
    // The template title is a starting point for the title field.
    setTitle(chosen ? chosen.title : "");
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!title.trim()) {
      return;
    }
    if (template && onAddFromTemplate) {
      onAddFromTemplate(template.id, targetId, title);
    } else {
      onAdd(title, targetId);
    }
    setTitle("");
    setTemplateId("");
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-wrap gap-2">
      {withTemplates && (
        <Select aria-label="From template" value={template?.id ?? ""} onChange={(event) => chooseTemplate(event.target.value)}>
          <option value="">None</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </Select>
      )}
      <Input
        aria-label="New card title"
        placeholder="What needs to be done?"
        value={title}
        maxLength={MAX_TITLE_LENGTH}
        onChange={(event) => setTitle(event.target.value)}
        className="min-w-0 flex-1"
      />
      {lists.length > 0 && (
        <Select aria-label="Target list" value={targetId} onChange={(event) => setListId(event.target.value)}>
          {lists.map((l) => (
            <option key={l.id} value={l.id}>
              {l.name}
            </option>
          ))}
        </Select>
      )}
      <Button type="submit" variant="primary" disabled={!title.trim()}>
        Add card
      </Button>
    </form>
  );
}
