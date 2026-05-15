export function formatPercent(rate: number, decimals = 0): string {
  return `${(rate * 100).toFixed(decimals)}%`;
}

export function formatAverage(value: number, decimals = 1): string {
  return value.toFixed(decimals);
}

export function formatCount(value: number, unit: string): string {
  return `${value}${unit}`;
}
