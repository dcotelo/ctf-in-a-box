# Design plan — the original identity, enhanced

This branch first shipped a full "review queue" retheme (monochrome
paper-on-ink, Archivo/Public Sans). The organizer reviewed it on the live box
and rejected the theme — the direction is now **the original navy/blue
terminal identity, refined**, with the redesign's structural wins kept.

`DESIGN_SYSTEM.md` is the palette and token authority (it always described
the original identity). This file records what carries over from the
redesign, what reverted, and the rules that keep the two coherent.

## The stance

- **Theme = original.** Deep navy grounds (`#1a1a2e` page, `#16162a` cards,
  `#12121e` deepest), blue `#2563eb` as the single brand accent (`#60a5fa`
  for body-size links), semantic green/red/amber/teal exactly as
  DESIGN_SYSTEM.md defines them. Terminal personality is deliberate:
  the `$ owasp-ctf` wordmark (green `$`, mono), `$ sign-in --github`,
  mono for data. The OWASP logo anchors the landing hero — this kit's
  flagship event is an OWASP event and says so.
- **Structure = redesign.** The layouts shipped by the redesign stay:
  the landing as a pitch with one state-aware CTA, the challenge browser as
  a flat filterable queue under sticky target headers, the leaderboard's
  `?display=1` projector mode, the phase line, the check atom, the "Your
  run" rail on the classic board.

## Enhancements over stock-original (keep these)

- **Amber focus rings** (`outline-[#d4a017]`) everywhere — one focus color,
  visibly distinct from both the blue accent and the grounds.
- **`.ds-link`** underlined inline links in `--accent-blue-link`; color
  alone can't carry the affordance inside body text (WCAG 1.4.1).
- **`.ds-tap-24`** grown pointer targets on dense chip rows (WCAG 2.5.8).
- **`tabular-nums`** on everything numeric (ranks, points, counts).
- **Motion discipline**: `check-land` (the one celebratory animation) and
  `head-breathe` (the phase line's HEAD marker) survive; everything is
  neutralized under `prefers-reduced-motion`. The old scanline/pulse-glow
  loops stay retired.
- **`.ds-card` hover** = border brighten + the original accent glow.

## The two system shapes (kept from the redesign)

1. **The check atom** (`score-check.tsx`): every score renders as a status
   dot + verdict + points, like a CI check line. Green `#22c55e` = scored,
   red `#e53e3e` = failed, amber `#d4a017` = pending, hollow = untouched.
2. **The phase line** (`phase-line.tsx`): the event's phases as a git graph
   under the header — `registration → live → frozen → results` — HEAD on
   now. `resolvePhase` shares `outsideWindow` with enforcement and fails
   silent on a settings error by design.

## Type

Original stack: **Poppins** (headings, via the global `h1–h6` rule and the
`font-display` utility), **Barlow** (body), **Geist Mono** (data, prompts,
counts). All `next/font`, self-hosted.

## Rules that keep it coherent

- Blue is the brand: solid CTAs are `bg-[#2563eb] hover:bg-[#1d4ed8]`
  with white text; secondary actions are bordered ghosts that pick up
  `border-[#2563eb]/45` on hover.
- Teal `#14b8a6` is the eyebrow/kicker color and the rank-3 podium accent —
  punctuation, never a surface.
- State colors keep their meanings from the redesign: green only for
  scored/solved, red only for failed/destructive, amber only for
  pending/attention/focus.
- Event copy stays `event.yaml`-driven; the `$ owasp-ctf` wordmark is the
  kit's brand and the one deliberate exception.
