import { sanitizeExportFilename } from '@/services/export/share';

describe('sanitizeExportFilename', () => {
  it('replaces path separators and illegal filename characters', () => {
    expect(sanitizeExportFilename('../練習:試合?.csv')).toBe('練習_試合_.csv');
  });

  it('falls back for empty names', () => {
    expect(sanitizeExportFilename('   ')).toBe('export.txt');
  });
});
