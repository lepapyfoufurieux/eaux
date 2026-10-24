/** The four flow levels, driest first. Codes match the backend's FlowLevel. */
export const FLOW_LEVELS = ["dry", "very_low", "normal", "high"] as const;
export type FlowLevel = (typeof FLOW_LEVELS)[number];

export const FLOW: Record<FlowLevel, { label: string; short: string; hint: string; colour: string }> = {
  dry: { label: "Assec", short: "Assec", hint: "lit à sec, pas d'eau visible", colour: "var(--flow-dry)" },
  very_low: { label: "Débit très faible", short: "Très faible", hint: "filet d'eau, flaques", colour: "var(--flow-very-low)" },
  normal: { label: "Débit normal", short: "Normal", hint: "écoulement habituel", colour: "var(--flow-normal)" },
  high: { label: "Débit important", short: "Important", hint: "hautes eaux, crue", colour: "var(--flow-high)" },
};

export const UNKNOWN_COLOUR = "var(--flow-unknown)";

export const flowRank = (level: FlowLevel): number => FLOW_LEVELS.indexOf(level);

export const flowColour = (level: FlowLevel | null | undefined): string => (level ? FLOW[level].colour : UNKNOWN_COLOUR);
