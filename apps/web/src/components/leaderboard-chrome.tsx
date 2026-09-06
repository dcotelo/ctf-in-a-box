// The two pieces of row furniture both leaderboard rows draw: the podium rank
// chip and the avatar. Shared rather than duplicated so a contestant row and a
// team row cannot drift apart on the one thing that makes them look like the
// same board.

import Image from "next/image";

// Podium accents for the top three, drawn from the design tokens.
const PODIUM: Record<number, string> = {
  1: "#d4a017", // gold
  2: "#a1a1aa", // silver
  3: "#14b8a6", // teal-bronze
};

export function Avatar({ login, size = 32 }: { login: string; size?: number }) {
  return (
    <Image
      src={`https://avatars.githubusercontent.com/${login}`}
      alt=""
      width={size}
      height={size}
      className="flex-none rounded-full border border-white/10"
      unoptimized
    />
  );
}

export function RankChip({ rank }: { rank: number }) {
  const podium = PODIUM[rank];
  return (
    <span
      className="flex h-10 w-10 flex-none items-center justify-center rounded-md font-display text-lg font-black tabular-nums"
      style={{
        color: podium ?? "#8f8f9b",
        borderWidth: 1,
        borderStyle: "solid",
        borderColor: podium ? `${podium}66` : "rgba(255,255,255,0.08)",
        background: podium ? `${podium}14` : "transparent",
      }}
    >
      {rank}
    </span>
  );
}
