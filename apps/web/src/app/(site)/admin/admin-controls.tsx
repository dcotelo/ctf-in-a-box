"use client";

// The organizer admin page's control surface: a tab shell. One "Event" tab
// for the control-plane settings that belong to the platform itself (freeze,
// scoring/registration windows, demo seed, master reset), then one tab per
// entry in the resolved `modules` prop, labelled with the organizer's own
// title for that module. A module's knobs — the hint toggle, cost and gating
// live under Secure Development — therefore exist iff that module is enabled.
//
// This component owns ALL the settings state (`settings`, the draft input
// strings, `pending`, `error`, `confirm`) plus the `apply`/`commitNumber`
// helpers, and hands them to the tab bodies as props; the tabs are
// presentational. All writes go through POST /api/admin/settings (auth +
// validation enforced server-side — see src/app/api/admin/settings/route.ts);
// this component is display + dispatch only.
//
// Every panel is rendered into the DOM and hidden with the `hidden`
// attribute rather than conditionally unmounted. That is deliberate: it keeps
// each tab's own state (a half-typed hint cost, an open question form) alive
// across tab switches, and it is what lets the static-markup tests assert on
// a panel they are not "looking at" — a `{active === id && <Tab/>}` shell
// would render nothing for the other tabs and make those assertions vacuous.
//
// Accessibility: this is a surface an organizer drives during a live event,
// so the tablist implements the full WAI-ARIA tabs pattern — roving
// `tabIndex`, `aria-selected`/`aria-controls`/`aria-labelledby` wiring, and
// ArrowLeft/ArrowRight/Home/End movement with wraparound.

import { useEffect, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { formatRelativeTime } from "@/lib/relative-time";
import type { AdminSettings } from "@/lib/admin-store";
import { ALL_MODULE_IDS, bakedModuleIds, moduleDefById, type ModuleId, type ResolvedModule } from "@/lib/modules";
import ConfirmModal from "@/components/confirm-modal";
import AdminQuizControls from "@/components/admin-quiz-controls";
import AdminClassicControls from "@/components/admin-classic-controls";
import AdminAdminsTab from "./admin-admins-tab";
import AdminInsightsTab from "./admin-insights-tab";
import AdminSupportTab from "./admin-support-tab";
import AdminEventTab, { type ModuleChoice } from "./admin-event-tab";
import AdminSecureDevTab from "./admin-secure-dev-tab";
import AdminModuleIdentity from "./admin-module-identity";
import type { CommitNumber, ConfirmState } from "./types";

// Registry defaults (displayName/description) keyed by id, for the identity
// form's placeholders. Not the `modules` prop — a `ResolvedModule`
// deliberately has no `displayName`/`description` (see lib/modules.ts): those
// are what an override REPLACES, and this is the one place the admin panel
// needs the pre-override default alongside it.
//
// Built from the WHOLE registry rather than the baked set: a module enabled at
// runtime (issue #175) is renameable like any other, and keying this off
// event.yaml would leave its identity form with no placeholder to show.
const MODULE_DEFAULTS = new Map(
  ALL_MODULE_IDS.map((id) => {
    const def = moduleDefById(id);
    return [id as string, { title: def?.displayName ?? id, blurb: def?.description ?? "" }];
  }),
);

/** Every registry module as a toggle row (issue #175), in registry order.
 *
 *  Includes the ones this event has switched OFF — the whole point is to turn
 *  one back on, and a switch you cannot see is not a switch.
 *
 *  secure-development is present but not toggleable, with the reason on the
 *  row rather than a control that always errors. It is not a flag: its scorer
 *  and sync services are not running on an event that never enabled it (the
 *  app cannot start containers), and its targets are forks that only
 *  `ctf-setup.sh` can provision, holding a GitHub App key the web tier
 *  deliberately does not have. */
const MODULE_CHOICES: readonly ModuleChoice[] = ALL_MODULE_IDS.map((id) => ({
  id: id as string,
  label: moduleDefById(id)?.displayName ?? (id as string),
  toggleable: id !== "secure-development",
  reason: id === "secure-development" ? "Configured at setup — it needs its scorer, its sync poller and its provisioned forks." : undefined,
}));

/** The always-present control-plane tab. Module tabs follow it, in the order
 *  the event config lists them. */
const EVENT_TAB = "event";
/** Runtime admin management (issue #147). Sits beside Event rather than
 *  inside it: it manages WHO may use the panel, not what the event does. */
const ADMINS_TAB = "admins";
// Live-event support (issue #168). Sits after Admins and before the module
// tabs: it is control-plane, not module-specific, and an organizer reaching
// for it is mid-incident rather than mid-configuration.
const SUPPORT_TAB = "support";
// Engagement metrics (issue #169). Control-plane like Event/Admins/Support,
// and last of the four because it is read-only — an organizer reaches for it
// after the event more often than during it.
const INSIGHTS_TAB = "insights";

async function postSettings(patch: Record<string, unknown>): Promise<{ settings?: AdminSettings; error?: string }> {
  const res = await fetch("/api/admin/settings", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(patch),
  });
  const data = (await res.json().catch(() => ({}))) as { settings?: AdminSettings; error?: string };
  if (!res.ok) return { error: data.error ?? "Request failed" };
  return { settings: data.settings };
}

/** The audit line's timestamp, as "4m ago" rather than a raw ISO instant.
 *
 *  Renders nothing until mounted, for the same reason the countdowns do: this
 *  is a Client Component that still server-renders, and relative time read
 *  from a live clock during render disagrees with the server's render. So the
 *  server paints "last changed by alice" and the time appears on hydration.
 *
 *  The exact instant stays available on hover via `title` — an organizer
 *  reconciling an audit trail wants the precise value, just not in their face. */
function ChangedAt({ iso }: { iso: string }) {
  const [label, setLabel] = useState<string | null>(null);

  useEffect(() => {
    const tick = () => setLabel(formatRelativeTime(iso));
    const timeout = setTimeout(tick, 0);
    // 30s, not 1s: this line ages in minutes and nobody is watching it count.
    const interval = setInterval(tick, 30_000);
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [iso]);

  if (!label) return null;
  return <time dateTime={iso} title={iso}>{label}</time>;
}

export default function AdminControls({
  initial,
  demoMode = false,
  modules,
  initialTab,
  viewerLogin,
}: {
  initial: AdminSettings;
  demoMode?: boolean;
  /** Modules with the organizer's naming already applied (see
   *  lib/resolved-modules.ts). Render `title` — a `ResolvedModule` has no
   *  `displayName`, by design. */
  modules: readonly ResolvedModule[];
  /** Which tab to open on arrival, from `/admin?tab=<module id>`. Anything
   *  this shell doesn't recognise — a typo, or a module this event didn't
   *  enable — falls back to Event rather than opening nothing. Resolved on
   *  the server (see page.tsx) so the first render already has the right
   *  panel open; the organizer never sees it flip. */
  initialTab?: string;
  /** The signed-in organizer's GitHub login, from the same `requireAdmin`
   *  gate that rendered this page. The Admins tab uses it to warn before
   *  someone revokes their own access. */
  viewerLogin: string;
}) {
  const [settings, setSettings] = useState(initial);
  const [hintCostInput, setHintCostInput] = useState(initial.hintCost === null ? "" : String(initial.hintCost));
  const [minSolvesInput, setMinSolvesInput] = useState(
    initial.hintsMinSolves === null ? "" : String(initial.hintsMinSolves),
  );
  const [unlockAfterInput, setUnlockAfterInput] = useState(
    initial.hintsUnlockAfterMin === null ? "" : String(initial.hintsUnlockAfterMin),
  );
  const [quizMaxAttemptsInput, setQuizMaxAttemptsInput] = useState(
    initial.quizMaxAttempts === null ? "" : String(initial.quizMaxAttempts),
  );
  const [quizRetryAfterInput, setQuizRetryAfterInput] = useState(
    initial.quizRetryAfterMin === null ? "" : String(initial.quizRetryAfterMin),
  );
  const [classicCooldownSecInput, setClassicCooldownSecInput] = useState(
    initial.classicCooldownSec === null ? "" : String(initial.classicCooldownSec),
  );
  const [cooldownInput, setCooldownInput] = useState(
    initial.scoreCooldownMin === null ? "" : String(initial.scoreCooldownMin),
  );
  const [teamMaxMembersInput, setTeamMaxMembersInput] = useState(
    initial.teamMaxMembers === null ? "" : String(initial.teamMaxMembers),
  );
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<ConfirmState | null>(null);
  const [resetInfo, setResetInfo] = useState<string | null>(null);

  const tabs = [
    { id: EVENT_TAB, label: "Event" },
    { id: ADMINS_TAB, label: "Admins" },
    { id: SUPPORT_TAB, label: "Support" },
    { id: INSIGHTS_TAB, label: "Insights" },
    ...modules.map((mod) => ({ id: mod.id as string, label: mod.title })),
  ];
  const [active, setActive] = useState<string>(
    tabs.some((t) => t.id === initialTab) ? (initialTab as string) : EVENT_TAB,
  );
  const tabRefs = useRef<Record<string, HTMLButtonElement | null>>({});

  /** WAI-ARIA tabs keyboard model, automatic activation: moving focus moves
   *  the selection, so an organizer arrowing across the strip sees each panel
   *  without a second keystroke. Left/Right wrap; Home/End jump to the ends. */
  const onTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const last = tabs.length - 1;
    let next: number;
    if (e.key === "ArrowRight") next = index === last ? 0 : index + 1;
    else if (e.key === "ArrowLeft") next = index === 0 ? last : index - 1;
    else if (e.key === "Home") next = 0;
    else if (e.key === "End") next = last;
    else return;
    e.preventDefault();
    const id = tabs[next].id;
    setActive(id);
    tabRefs.current[id]?.focus();
  };

  const runConfirm = async () => {
    if (!confirm) return;
    setPending(true);
    try {
      await confirm.onConfirm();
    } finally {
      setPending(false);
      setConfirm(null);
    }
  };

  // Master reset: wipes all event data. Type-to-confirm gated in the modal;
  // the server re-checks the phrase and requires admin. On success the box is
  // frozen (the reset freezes scoring), so reflect that + show the counts.
  const doReset = async (confirmValue: string) => {
    setError(null);
    setResetInfo(null);
    const res = await fetch("/api/admin/reset", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ confirm: confirmValue }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      cleared?: Record<string, number>;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Reset failed");
      return;
    }
    setSettings((s) => ({ ...s, paused: true }));
    const total = Object.values(data.cleared ?? {}).reduce((a, b) => a + b, 0);
    setResetInfo(`Wiped ${total} keys — scoring is now frozen. Unfreeze when you're ready.`);
  };

  // DEMO_MODE only: populate a demo leaderboard (fake contestants + teams).
  const doSeed = async () => {
    setError(null);
    setResetInfo(null);
    const res = await fetch("/api/admin/seed", { method: "POST" });
    const data = (await res.json().catch(() => ({}))) as {
      contestants?: number;
      teams?: number;
      solves?: number;
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? "Seed failed");
      return;
    }
    setResetInfo(
      `Seeded ${data.contestants} contestants, ${data.teams} teams, ${data.solves} solves. The board revalidates within ~30s.`,
    );
  };

  /** Returns whether the patch was accepted, so a caller with its own local
   *  draft state (AdminModuleIdentity) can snap back on rejection instead of
   *  leaving rejected text sitting in the field. Every tab's `apply` prop
   *  type was widened to `Promise<boolean>` to match (a `Promise<T>` is not
   *  assignable to `Promise<void>` just because `T` goes unused — that's
   *  only true for a bare `void`-returning function type, not one nested
   *  inside a generic); callers that only need fire-and-forget keep calling
   *  it exactly the same way (`void apply(...)`), just ignoring the result. */
  const apply = async (patch: Record<string, unknown>): Promise<boolean> => {
    setPending(true);
    setError(null);
    const result = await postSettings(patch);
    if (result.error) {
      setError(result.error);
      setPending(false);
      return false;
    }
    if (result.settings) {
      const s = result.settings;
      setSettings(s);
      setHintCostInput(s.hintCost === null ? "" : String(s.hintCost));
      setMinSolvesInput(s.hintsMinSolves === null ? "" : String(s.hintsMinSolves));
      setUnlockAfterInput(s.hintsUnlockAfterMin === null ? "" : String(s.hintsUnlockAfterMin));
      setQuizMaxAttemptsInput(s.quizMaxAttempts === null ? "" : String(s.quizMaxAttempts));
      setQuizRetryAfterInput(s.quizRetryAfterMin === null ? "" : String(s.quizRetryAfterMin));
      setClassicCooldownSecInput(s.classicCooldownSec === null ? "" : String(s.classicCooldownSec));
    }
    setPending(false);
    return true;
  };

  /** Shared commit for the numeric knobs (hint + quiz): junk snaps back to the
   *  stored value, an unchanged value is a no-op, otherwise it's patched
   *  server-side (which re-validates the range — see admin-store). */
  // Typed as the shared `CommitNumber` rather than repeating its key union
  // here. The inline copy had already drifted once by the time a seventh key
  // was added, and a mismatch shows up as a type error at the call site rather
  // than anywhere near the cause.
  const commitNumber: CommitNumber = (key, raw, reset) => {
    const current = settings[key];
    const value = Number(raw);
    if (raw.trim() === "" || !Number.isInteger(value) || value < 0) {
      reset(current === null ? "" : String(current));
      return;
    }
    if (value === current) return;
    void apply({ [key]: value });
  };

  return (
    <div className="ds-card flex flex-col gap-4 rounded-lg border border-white/[0.06] bg-[#16162a] p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-zinc-400">Controls</h2>

      <div role="tablist" aria-label="Admin controls" className="flex flex-wrap gap-1 border-b border-white/[0.06]">
        {tabs.map((tab, index) => (
          <button
            key={tab.id}
            type="button"
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={active === tab.id}
            aria-controls={`panel-${tab.id}`}
            tabIndex={active === tab.id ? 0 : -1}
            ref={(el) => {
              tabRefs.current[tab.id] = el;
            }}
            onClick={() => setActive(tab.id)}
            onKeyDown={(e) => onTabKeyDown(e, index)}
            className={
              active === tab.id
                ? "-mb-px rounded-t-md border-b-2 border-[#2563eb]/70 px-3 py-2 text-sm font-medium text-white"
                : "-mb-px rounded-t-md border-b-2 border-transparent px-3 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200"
            }
          >
            {tab.label}
          </button>
        ))}
      </div>

      {tabs.map((tab) => (
        <div
          key={tab.id}
          role="tabpanel"
          id={`panel-${tab.id}`}
          aria-labelledby={`tab-${tab.id}`}
          hidden={active !== tab.id}
        >
          {tab.id === EVENT_TAB ? (
            <AdminEventTab
              settings={settings}
              pending={pending}
              demoMode={demoMode}
              resetInfo={resetInfo}
              apply={apply}
              setConfirm={setConfirm}
              doReset={doReset}
              doSeed={doSeed}
              teamMaxMembersInput={teamMaxMembersInput}
              setTeamMaxMembersInput={setTeamMaxMembersInput}
              commitNumber={commitNumber}
          moduleChoices={MODULE_CHOICES}
          liveModuleIds={settings.enabledModuleIds ?? bakedModuleIds}
            />
          ) : tab.id === ADMINS_TAB ? (
            <AdminAdminsTab viewerLogin={viewerLogin} />
          ) : tab.id === SUPPORT_TAB ? (
            <AdminSupportTab setConfirm={setConfirm} />
          ) : tab.id === INSIGHTS_TAB ? (
            <AdminInsightsTab />
          ) : (
            <section className="flex flex-col gap-4">
              <AdminModuleIdentity
                moduleId={tab.id}
                defaults={MODULE_DEFAULTS.get(tab.id) ?? { title: tab.label, blurb: "" }}
                override={settings.moduleOverrides[tab.id as ModuleId]}
                pending={pending}
                apply={apply}
              />
              {tab.id === "secure-development" ? (
                <AdminSecureDevTab
                  settings={settings}
                  pending={pending}
                  apply={apply}
                  hintCostInput={hintCostInput}
                  setHintCostInput={setHintCostInput}
                  minSolvesInput={minSolvesInput}
                  setMinSolvesInput={setMinSolvesInput}
                  unlockAfterInput={unlockAfterInput}
                  setUnlockAfterInput={setUnlockAfterInput}
                  commitNumber={commitNumber}
                  cooldownInput={cooldownInput}
                  setCooldownInput={setCooldownInput}
                />
              ) : tab.id === "quiz" ? (
                <AdminQuizControls
                  pending={pending}
                  quizMaxAttemptsInput={quizMaxAttemptsInput}
                  setQuizMaxAttemptsInput={setQuizMaxAttemptsInput}
                  quizRetryAfterInput={quizRetryAfterInput}
                  setQuizRetryAfterInput={setQuizRetryAfterInput}
                  commitNumber={commitNumber}
                />
              ) : tab.id === "classic" ? (
                <AdminClassicControls
                  pending={pending}
                  classicCooldownSecInput={classicCooldownSecInput}
                  setClassicCooldownSecInput={setClassicCooldownSecInput}
                  commitNumber={commitNumber}
                />
              ) : (
                <p className="text-xs text-muted">No settings for this module yet.</p>
              )}
            </section>
          )}
        </div>
      ))}

      {settings.updatedBy && settings.updatedAt && (
        <p className="text-xs text-muted">
          last changed by {settings.updatedBy} <ChangedAt iso={settings.updatedAt} />
        </p>
      )}
      {error && <p className="text-xs text-[#e53e3e]">{error}</p>}

      {confirm && (
        <ConfirmModal
          title={confirm.title}
          body={confirm.body}
          confirmLabel={confirm.confirmLabel}
          requireType={confirm.requireType}
          danger={confirm.danger}
          pending={pending}
          onConfirm={() => void runConfirm()}
          onCancel={() => !pending && setConfirm(null)}
        />
      )}
    </div>
  );
}
