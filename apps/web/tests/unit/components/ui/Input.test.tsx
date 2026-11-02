import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";
import { Input, Select, Textarea } from "@/components/ui/Input";

function Fields() {
  const [choice, setChoice] = useState("a");
  return (
    <>
      <label htmlFor="name">Name</label>
      <Input id="name" aria-invalid={true} />
      <label htmlFor="notes">Notes</label>
      <Textarea id="notes" />
      <label htmlFor="pick">Pick</label>
      <Select id="pick" value={choice} onChange={(event) => setChoice(event.target.value)}>
        <option value="a">A</option>
        <option value="b">B</option>
      </Select>
    </>
  );
}

describe("<Input /> / <Textarea /> / <Select />", () => {
  it("are associated with their labels and accept typing and selection", async () => {
    const user = userEvent.setup();
    render(<Fields />);
    await user.type(screen.getByLabelText("Name"), "hello");
    await user.type(screen.getByLabelText("Notes"), "some notes");
    await user.selectOptions(screen.getByLabelText("Pick"), "b");
    expect(screen.getByLabelText("Name")).toHaveValue("hello");
    expect(screen.getByLabelText("Notes")).toHaveValue("some notes");
    expect(screen.getByLabelText("Pick")).toHaveValue("b");
  });

  it("pass aria-invalid through", () => {
    render(<Fields />);
    expect(screen.getByLabelText("Name")).toHaveAttribute("aria-invalid", "true");
  });

  it("share the field style, with a compact size and merged className", () => {
    render(
      <>
        <Input aria-label="Default" className="w-full" />
        <Input aria-label="Small" fieldSize="sm" />
      </>,
    );
    expect(screen.getByLabelText("Default")).toHaveClass("border-field", "bg-surface", "w-full", "px-3");
    expect(screen.getByLabelText("Small")).toHaveClass("border-field", "px-1.5");
  });
});
