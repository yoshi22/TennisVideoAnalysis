import { type TennisSession } from '@/types/session';

const BOM = '﻿';

const HEADERS = [
  'timestamp',
  'outcome',
  'shotType',
  'resultReason',
  'rallyCount',
  'serveResult',
  'shotLocationX',
  'shotLocationY',
  'targetLocationX',
  'targetLocationY',
  'videoTimestamp',
  'note',
] as const;

function escapeField(value: string | number | undefined | null): string {
  if (value === undefined || value === null) return '';
  const str = String(value);
  if (str.includes(',') || str.includes('"') || str.includes('\n')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export function buildPointsCSV(session: TennisSession): string {
  const header = HEADERS.join(',');
  const rows = session.points.map((p) => {
    const fields = [
      p.timestamp,
      p.outcome,
      p.shotType,
      p.resultReason,
      p.rallyCount,
      p.serveResult ?? '',
      p.shotLocation?.x ?? '',
      p.shotLocation?.y ?? '',
      p.targetLocation?.x ?? '',
      p.targetLocation?.y ?? '',
      p.videoTimestamp ?? '',
      p.note ?? '',
    ];
    return fields.map(escapeField).join(',');
  });

  return BOM + [header, ...rows].join('\r\n');
}
