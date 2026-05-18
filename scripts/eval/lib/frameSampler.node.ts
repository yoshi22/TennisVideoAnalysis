import { spawn } from 'node:child_process';
import { mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

export interface ExtractFramesOptions {
  /** Input video file path */
  videoPath: string;
  /** Output directory for JPEG frames */
  outputDir: string;
  /** Frames per second to extract (default: 3) */
  fps?: number;
}

/**
 * Extracts JPEG frames from a video at the given fps using ffmpeg.
 * Returns sorted list of absolute file paths.
 */
export async function extractFramesNode(opts: ExtractFramesOptions): Promise<string[]> {
  const { videoPath, outputDir, fps = 3 } = opts;

  mkdirSync(outputDir, { recursive: true });

  await new Promise<void>((resolve, reject) => {
    const args = [
      '-y',
      '-i',
      videoPath,
      // Scale to 1280px wide (keeps 720p for 1080p source) and sample at given fps.
      // q:v 5 (~60-80 KB/frame) is sufficient for blob-based ball detection.
      '-vf',
      `scale=1280:-1,fps=${fps}`,
      '-q:v',
      '5',
      join(outputDir, 'frame_%06d.jpg'),
    ];

    const proc = spawn('ffmpeg', args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    proc.stderr?.on('data', (d: Buffer) => (stderr += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) reject(new Error(`ffmpeg exited ${code}: ${stderr.slice(-300)}`));
      else resolve();
    });
    proc.on('error', (err) => reject(new Error(`ffmpeg not found: ${err.message}`)));
  });

  return readdirSync(outputDir)
    .filter((f) => f.endsWith('.jpg'))
    .sort()
    .map((f) => join(outputDir, f));
}

/**
 * Returns duration of a video in seconds using ffprobe.
 */
export async function getVideoDurationSec(videoPath: string): Promise<number> {
  return new Promise<number>((resolve, reject) => {
    const args = ['-v', 'quiet', '-print_format', 'json', '-show_format', videoPath];
    const proc = spawn('ffprobe', args, { stdio: ['ignore', 'pipe', 'ignore'] });
    let stdout = '';
    proc.stdout?.on('data', (d: Buffer) => (stdout += d.toString()));
    proc.on('close', (code) => {
      if (code !== 0) return reject(new Error(`ffprobe exited ${code}`));
      try {
        const parsed = JSON.parse(stdout) as { format?: { duration?: string } };
        const dur = parseFloat(parsed.format?.duration ?? '0');
        resolve(isNaN(dur) ? 0 : dur);
      } catch {
        reject(new Error('Failed to parse ffprobe output'));
      }
    });
    proc.on('error', (err) => reject(new Error(`ffprobe not found: ${err.message}`)));
  });
}
