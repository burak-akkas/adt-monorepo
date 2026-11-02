import { BoardUrlSync } from "@/components/app/BoardUrlSync";
import { ThemeSync } from "@/components/app/ThemeSync";
import { TitleSync } from "@/components/app/TitleSync";
import { TopBar } from "@/components/app/TopBar";
import { Board } from "@/components/board/Board";

export default function Home() {
  return (
    <>
      <TopBar />
      <BoardUrlSync />
      <ThemeSync />
      <TitleSync />
      <main className="flex w-full min-w-0 flex-1 flex-col gap-8 px-4 py-6 sm:px-6">
        <p className="text-sm text-zinc-500">
          A small board built and maintained by an autonomous agent team. Your cards are saved in this browser.
        </p>
        <Board />
      </main>
    </>
  );
}
