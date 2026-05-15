import { format, formatDistanceToNow, parseISO } from 'date-fns';
import { ja } from 'date-fns/locale';

export function formatDate(isoString: string): string {
  return format(parseISO(isoString), 'yyyy年M月d日', { locale: ja });
}

export function formatDateShort(isoString: string): string {
  return format(parseISO(isoString), 'M/d', { locale: ja });
}

export function formatRelative(isoString: string): string {
  return formatDistanceToNow(parseISO(isoString), { locale: ja, addSuffix: true });
}

export function toISODate(date: Date): string {
  return format(date, 'yyyy-MM-dd');
}

export function todayISO(): string {
  return toISODate(new Date());
}
