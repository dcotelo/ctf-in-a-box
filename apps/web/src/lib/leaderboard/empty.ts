import "server-only";
import type { LeaderboardSource } from "./source";
import type { LeaderboardData } from "./types";

/**
 * The board for an event with NO scored module: no entries, no teams, no
 * capabilities. Everything a contestant sees is then built by the module
 * overlays in the `/leaderboard` pipeline — `withModuleContributions` creates
 * a row per login holding module points, and `withTeamStandings` overlays
 * membership onto them.
 *
 * Deliberately NOT the mock source. Mock data on a real event is worse than an
 * empty board: contestants cannot tell placeholder standings from their own
 * scores, and the amber notice that normally explains them keys off the source
 * MODE, which is "empty" here rather than "mock".
 *
 * `capabilities` are all false because they are claims about what this source
 * can supply, and it supplies nothing: `apps: false` in particular is what
 * stops `withModuleContributions` inventing a `secure-development` block, and
 * `teams: false` is what hands team rows to `withTeamStandings`.
 *
 * `generatedAt` is stamped per call (rather than fixed) because the page
 * formats every row's relative time against it.
 */
export const emptySource: LeaderboardSource = {
  async getLeaderboard(): Promise<LeaderboardData> {
    return {
      entries: [],
      teams: [],
      generatedAt: new Date().toISOString(),
      capabilities: { apps: false, teams: false, challenges: false },
    };
  },

  /** `/profile`'s scoring panel: there is no scorer, so there is no profile to
   *  serve. The page already handles `null` (it is what an unscored login
   *  returns from every other source) and renders the module sections it can
   *  build on its own. */
  async getUser() {
    return null;
  },
};
