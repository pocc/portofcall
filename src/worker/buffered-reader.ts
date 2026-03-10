/**
 * BufferedReader wraps a ReadableStreamDefaultReader and ensures that excess
 * bytes returned by reader.read() are not silently discarded. When TCP segments
 * coalesce (common with Nagle's algorithm or fast servers), a single read() can
 * return data spanning multiple protocol messages. Without buffering, the bytes
 * beyond the requested count are lost, causing protocol desync on subsequent
 * reads.
 */
export class BufferedReader {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private buf: Uint8Array = new Uint8Array(0);
  private static readonly MAX_BUFFER = 16 * 1024 * 1024; // 16 MiB safety cap

  constructor(reader: ReadableStreamDefaultReader<Uint8Array>) {
    this.reader = reader;
  }

  /** Read exactly `n` bytes, optionally racing against a timeout/deadline promise. */
  async readExact(n: number, timeoutPromise?: Promise<never>): Promise<Uint8Array> {
    if (n > BufferedReader.MAX_BUFFER) {
      throw new Error(`Requested ${n} bytes exceeds maximum buffer size of ${BufferedReader.MAX_BUFFER}`);
    }
    while (this.buf.length < n) {
      const readOp = this.reader.read();
      const { value, done } = timeoutPromise
        ? await Promise.race([readOp, timeoutPromise])
        : await readOp;
      if (done || !value) {
        throw new Error(
          `Connection closed after ${this.buf.length} bytes (expected ${n})`,
        );
      }
      const merged = new Uint8Array(this.buf.length + value.length);
      merged.set(this.buf);
      merged.set(value, this.buf.length);
      this.buf = merged;
    }

    const result = this.buf.slice(0, n);
    this.buf = this.buf.slice(n);
    return result;
  }

  /** Return a copy of buffered bytes without consuming from the stream. */
  peek(): Uint8Array {
    return this.buf.slice();
  }

  /** Drain leftover buffer (useful when handing control back to raw reader). */
  get leftover(): Uint8Array {
    return this.buf.slice();
  }

  /** Access the underlying reader (e.g. for cancel/releaseLock). */
  get raw(): ReadableStreamDefaultReader<Uint8Array> {
    return this.reader;
  }
}
