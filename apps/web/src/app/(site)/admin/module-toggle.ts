// The module on/off switch's rules, as pure functions — shared by the Event
// tab's Modules section and each module panel's own header switch
// (admin-redesign.md § Content screens), so the two places an organizer can
// flip a module can never disagree about when it is locked or what the
// confirmation says.
//
// The last LIVE module cannot be switched off — the server refuses a set that
// would end up empty (ADR 24's runtime analogue), and a control that always
// errors is worse than one that explains itself. "Live" is counted over
// every enabled module, INCLUDING the ones that cannot be toggled: on a
// secure-development + quiz event, quiz is not "the last one" — secure-
// development is serving too. What makes a set legal is that SOMETHING is
// live, not that something switchable is live.

export type ModuleToggleChoice = {
  id: string;
  label: string;
  /** False for secure-development, which is provisioning rather than a flag.
   *  `reason` says so on the row instead of leaving a dead control. */
  toggleable: boolean;
  reason?: string;
};

/** What the switch for one module shows: on or off, whether it can be
 *  flipped, and the one sentence that explains a locked switch. */
export function moduleToggleState(
  mod: ModuleToggleChoice,
  live: ReadonlySet<string>,
  /** Every live module the registry knows, toggleable or not. */
  liveCount: number,
): { on: boolean; disabled: boolean; help: string | undefined } {
  const on = live.has(mod.id);
  const isLastOn = on && mod.toggleable && liveCount === 1;
  return {
    on,
    disabled: !mod.toggleable || isLastOn,
    help: !mod.toggleable && mod.reason ? mod.reason : isLastOn ? "The only module left — an event has to serve something." : undefined,
  };
}

/** The confirmation for flipping one module, and the enabled set it writes.
 *  Same words on Event and on the module's own panel. */
export function moduleToggleConfirm(
  mod: ModuleToggleChoice,
  next: boolean,
  live: ReadonlySet<string>,
): { title: string; body: string; confirmLabel: string; ids: string[] } {
  const ids = next ? [...live, mod.id] : [...live].filter((id) => id !== mod.id);
  return {
    title: next ? `Enable ${mod.label}?` : `Disable ${mod.label}?`,
    body: next
      ? `${mod.label} appears in the nav and its board opens, for everyone, on their next page load.`
      : `${mod.label} disappears from the nav and its board stops resolving, for everyone, on their next page load. Nothing is deleted — enabling it again brings the same board back.`,
    confirmLabel: next ? "Enable" : "Disable",
    ids,
  };
}
