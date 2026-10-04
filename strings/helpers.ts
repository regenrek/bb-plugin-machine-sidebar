/** `[singular, plural]` word forms for counted labels like "2 subagents running". */
export type Plural = readonly [one: string, many: string];

export const forms = (one: string, many: string): Plural => [one, many];
export const plural = (count: number, one: string, many: string) => (count === 1 ? one : many);
