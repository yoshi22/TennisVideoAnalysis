// コートSVG座標（ピクセル）↔ 正規化座標（0-1）の変換ユーティリティ
export interface NormalizedPoint {
  x: number; // 0..1 (左=0, 右=1)
  y: number; // 0..1 (手前=0, 奥=1)
}

export interface CanvasPoint {
  x: number;
  y: number;
}

export function toNormalized(canvas: CanvasPoint, width: number, height: number): NormalizedPoint {
  return {
    x: Math.max(0, Math.min(1, canvas.x / width)),
    y: Math.max(0, Math.min(1, canvas.y / height)),
  };
}

export function toCanvas(normalized: NormalizedPoint, width: number, height: number): CanvasPoint {
  return {
    x: normalized.x * width,
    y: normalized.y * height,
  };
}

export function distanceBetween(a: NormalizedPoint, b: NormalizedPoint): number {
  return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2);
}
