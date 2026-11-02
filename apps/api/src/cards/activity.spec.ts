import type { Prisma } from "../generated/prisma/client.js";
import { recordActivity } from "./activity.js";

const makeTx = (excess: { id: string }[]) => {
  const create = vi.fn().mockResolvedValue({});
  const findMany = vi.fn().mockResolvedValue(excess);
  const deleteMany = vi.fn().mockResolvedValue({ count: excess.length });
  const tx = { cardActivity: { create, findMany, deleteMany } } as unknown as Prisma.TransactionClient;
  return { tx, create, findMany, deleteMany };
};

describe("recordActivity", () => {
  it("writes through the given client and stores from/to only when non-empty", async () => {
    const { tx, create } = makeTx([]);
    await recordActivity(tx, "c1", { type: "title", from: "a", to: "" });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ cardId: "c1", type: "title", from: "a", to: null }) });
    await recordActivity(tx, "c1", { type: "created" });
    expect(create).toHaveBeenLastCalledWith({ data: expect.objectContaining({ type: "created", from: null, to: null }) });
  });

  it("uses an explicit timestamp when given, otherwise now", async () => {
    const { tx, create } = makeTx([]);
    const at = new Date("2026-01-01T00:00:00.000Z");
    await recordActivity(tx, "c1", { type: "created", at });
    expect(create).toHaveBeenCalledWith({ data: expect.objectContaining({ at }) });
    await recordActivity(tx, "c1", { type: "created" });
    expect(create.mock.calls[1][0].data.at).toBeInstanceOf(Date);
  });

  it("looks beyond the newest 50 in read order and deletes only those", async () => {
    const { tx, findMany, deleteMany } = makeTx([{ id: "old1" }, { id: "old2" }]);
    await recordActivity(tx, "c1", { type: "created" });
    expect(findMany).toHaveBeenCalledWith({
      where: { cardId: "c1" },
      orderBy: [{ at: "desc" }, { id: "desc" }],
      skip: 50,
      select: { id: true },
    });
    expect(deleteMany).toHaveBeenCalledWith({ where: { id: { in: ["old1", "old2"] } } });
  });

  it("deletes nothing under the cap", async () => {
    const { tx, deleteMany } = makeTx([]);
    await recordActivity(tx, "c1", { type: "created" });
    expect(deleteMany).not.toHaveBeenCalled();
  });
});
