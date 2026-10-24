/** Months are counted as integers (year × 12 + month) so the time bar and the river view share one scale. */
export type MonthIndex = number;

const NAMES = ["janv.", "févr.", "mars", "avr.", "mai", "juin", "juil.", "août", "sept.", "oct.", "nov.", "déc."];

export const monthIndex = (date: Date): MonthIndex => date.getFullYear() * 12 + date.getMonth();

export const monthStart = (month: MonthIndex): Date => new Date(Math.floor(month / 12), month % 12, 1);

export const monthLabel = (month: MonthIndex): string => `${NAMES[month % 12]} ${Math.floor(month / 12)}`;

export function monthRange(dates: Date[]): [MonthIndex, MonthIndex] {
  if (dates.length === 0) {
    const now = monthIndex(new Date());
    return [now, now];
  }
  const indexes = dates.map(monthIndex);
  return [Math.min(...indexes), Math.max(...indexes)];
}
