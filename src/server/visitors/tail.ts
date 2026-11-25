// Following a transcript as it grows: each read takes only what was written after the last one, from
// the byte it stopped at, so a file of many megabytes is never read from the start again. Opened
// read-only, a read at a time, and never written to, moved or locked.
import { closeSync, fstatSync, openSync, readSync } from 'node:fs';
import { entries } from './transcript.js';

/** The most a read takes: more than that written since the last one, and only its end is read. */
export const TAIL_READ = 4 * 1024 * 1024;
/** A line longer than this (a pasted image, a huge tool result) is skipped rather than held on to. */
export const TAIL_LINE = 2 * 1024 * 1024;

const NEWLINE = 0x0a;

export class TranscriptTail {
  /** Where the next read starts: everything before it has been read (but the line in `partial`). */
  offset = 0;
  /** The start of a line whose end hasn't been written yet. */
  private partial: Buffer = Buffer.alloc(0);
  /** Reading from the middle of a line, which is dropped up to its end. */
  private skipping = false;

  /** `from`: the most of what's there already to take on the first read (its end); the rest is skipped. */
  constructor(
    readonly file: string,
    from = TAIL_READ,
  ) {
    try {
      const fd = openSync(file, 'r');
      try {
        const size = fstatSync(fd).size;
        this.offset = Math.max(0, size - from);
        this.skipping = this.offset > 0;
      } finally {
        closeSync(fd);
      }
    } catch {
      // Not there (yet): read from its start once it is.
    }
  }

  /**
   * The entries written since the last read, oldest first. `reset`: the file got shorter (rewritten,
   * or a new one put in its place), so it was read again from its end as if new.
   */
  read(max = TAIL_READ): { entries: any[]; reset: boolean } {
    let fd: number | undefined;
    try {
      fd = openSync(this.file, 'r');
      const size = fstatSync(fd).size;
      let reset = false;
      if (size < this.offset) {
        reset = true;
        this.offset = Math.max(0, size - max);
        this.partial = Buffer.alloc(0);
        this.skipping = this.offset > 0;
      }
      if (size === this.offset) return { entries: [], reset };
      if (size - this.offset > max) {
        // Too much at once: only its end, from the first whole line in it.
        this.offset = size - max;
        this.partial = Buffer.alloc(0);
        this.skipping = true;
      }
      const buf = Buffer.alloc(size - this.offset);
      const got = readSync(fd, buf, 0, buf.length, this.offset);
      this.offset += got;
      return { entries: this.take(buf.subarray(0, got)), reset };
    } catch {
      return { entries: [], reset: false };
    } finally {
      if (fd !== undefined) closeSync(fd);
    }
  }

  /** The whole lines in what was just read, with the start of a line held over from the last read. */
  private take(chunk: Buffer): any[] {
    let data = this.partial.length ? Buffer.concat([this.partial, chunk]) : chunk;
    this.partial = Buffer.alloc(0);
    if (this.skipping) {
      const nl = data.indexOf(NEWLINE);
      if (nl < 0) return [];
      data = data.subarray(nl + 1);
      this.skipping = false;
    }
    const last = data.lastIndexOf(NEWLINE);
    const rest = data.subarray(last + 1);
    if (rest.length > TAIL_LINE) this.skipping = true;
    else this.partial = Buffer.from(rest);
    if (last < 0) return [];
    return entries({ text: data.subarray(0, last).toString('utf8'), whole: true }, 'tail');
  }
}
