import { ApiStatus } from "@/components/ApiStatus";

export default function HomePage() {
  return (
    <main className="mx-auto max-w-2xl px-4 py-12">
      <h1 className="text-3xl font-semibold">Kanban</h1>
      <ApiStatus />
    </main>
  );
}
