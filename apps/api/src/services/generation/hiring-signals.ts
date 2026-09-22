/**
 * Section 3: "A hiring-process page, once found, changes what questions
 * make sense: a company that publishes a take-home followed by a system
 * design round should produce a different kit from one that says
 * nothing."
 *
 * This is the small, deterministic signal-detection step that lets the
 * *category plan* (plan-categories.ts — code, not the model) react to
 * what the hiring page and public discussion actually say. It only ever
 * decides yes/no on a handful of well-known interview formats; it never
 * decides question content — that stays the model's job, given the raw
 * text as context.
 */
export interface HiringSignals {
  mentionsSystemDesign: boolean;
  mentionsTakeHome: boolean;
  mentionsBehaviouralRound: boolean;
  mentionsOnsitePanel: boolean;
}

const SIGNAL_PATTERNS: Record<keyof HiringSignals, RegExp> = {
  mentionsSystemDesign: /system[\s-]?design|architecture (interview|round)/i,
  mentionsTakeHome: /take[\s-]?home|take home assignment|coding challenge/i,
  mentionsBehaviouralRound: /behavio(u)?ral|culture fit|values interview/i,
  mentionsOnsitePanel: /on-?site|panel interview|final round/i,
};

export function detectHiringSignals(...texts: string[]): HiringSignals {
  const combined = texts.filter(Boolean).join("\n");
  const entries = Object.entries(SIGNAL_PATTERNS) as [keyof HiringSignals, RegExp][];
  const result = {} as HiringSignals;
  for (const [key, pattern] of entries) {
    result[key] = pattern.test(combined);
  }
  return result;
}
