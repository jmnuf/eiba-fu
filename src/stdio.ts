import { openSync, closeSync, writeSync, readSync } from 'node:fs';
import { Result } from './utils';

export type FILE = number & {};

export function fopen(path: string, flags: 'r' | 'w' | 'r+' | 'w+'): Result<FILE, Error> {
  try {
    const fd = openSync(path, flags);
    return Result.Ok(fd);
  } catch (e) {
    return Result.Err(e as Error);
  }
}

export function fclose(fd: FILE) {
  closeSync(fd);
}

export function fputc(c: number, fd: FILE) {
  if (c < 0) c = 0;
  else if (c > 255) c = 255;
  return fwrite(Uint8Array.from([c]).buffer, fd);
}

export function fwrite(buf: ArrayBuffer, fd: FILE) {
  const view = new DataView(buf);
  return writeSync(fd, view, 0, view.byteLength);
}

export function fputs(s: string, fd: FILE) {
  const buf = (new TextEncoder()).encode(s);
  return writeSync(fd, buf, 0, buf.byteLength);
}

const BYTES_MAP = {
  '%': '%'.charCodeAt(0),
  's': 's'.charCodeAt(0),
  'd': 'd'.charCodeAt(0),
  'u': 'u'.charCodeAt(0),
};
export function fprintf(fd: FILE, fmt: string, ...args: any[]) {
  const bytes = (new TextEncoder()).encode(fmt);
  let offset = 0;
  let length = 0;
  let count = 0;

  for (const c of bytes) {
    if (c != BYTES_MAP['%']) {
      length++;
      continue;
    }

    if (length > 0) {
      count += writeSync(fd, bytes, offset, length);
      offset += length;
      length = 0;
    }

    switch (c) {
      case BYTES_MAP['%']:
        length++;
        break;

      case BYTES_MAP['s']:
        offset++;
        count += fputs(String(args.shift()), fd);
        break;

      case BYTES_MAP['d']: {
        offset++;
        const view = Int32Array.from([Number(args.shift())]);
        const num = view[0]!.toString(10);
        count += fputs(num, fd);
      } break;

      case BYTES_MAP['u']: {
        offset++;
        const view = Uint32Array.from([Number(args.shift())]);
        const num = view[0]!.toString(10);
        count += fputs(num, fd);
      } break;

      default:
        throw new Error('Unknown format ' + String.fromCharCode(c));
    }
  }

  if (length) {
    count += writeSync(fd, bytes, offset, length);
  }

  return count;
}

export function fgetc(fd: FILE) {
  const view = new Uint8Array(1);
  const n = readSync(fd, view, 0, 1, null);
  if (n == 0) return -1;
  return view[0]!;
}

export function fread(buf: Uint8Array, fd: FILE): number {
  return readSync(fd, buf);
}

