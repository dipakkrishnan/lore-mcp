/**
 * XC-088: a hosted store keeps its tables in its own Durable Object, and the agent code reads them through the same
 * `D1Database` calls it makes on an owner's own node. Only the calls that code makes are here. Each store is its own
 * object with its own database, so no query can reach another store's rows.
 */

type Value = string | number | null | ArrayBuffer;
type Row = Record<string, SqlStorageValue>;

function values(bound: unknown[]): Value[] {
  return bound.map((value) => {
    if (value === undefined) throw new TypeError("D1_TYPE_ERROR: undefined can't be bound");
    if (typeof value === "boolean") return value ? 1 : 0;
    return value as Value;
  });
}

class Statement {
  constructor(
    private readonly sql: SqlStorage,
    readonly query: string,
    private readonly bound: Value[] = []
  ) {}

  bind(...bound: unknown[]): Statement {
    return new Statement(this.sql, this.query, values(bound));
  }

  /** Runs now; a batch calls it inside its transaction. */
  rows(): { rows: Row[]; written: number } {
    const cursor = this.sql.exec(this.query, ...this.bound);
    return { rows: cursor.toArray(), written: cursor.rowsWritten };
  }

  async first<T>(column?: string): Promise<T | null> {
    const [row] = this.rows().rows;
    if (!row) return null;
    return (column === undefined ? row : row[column]) as T;
  }

  async all<T>(): Promise<D1Result<T>> {
    return result(this.rows()) as D1Result<T>;
  }

  async run<T>(): Promise<D1Result<T>> {
    return this.all<T>();
  }

  async raw<T>(): Promise<T[]> {
    return this.rows().rows.map((row) => Object.values(row)) as T[];
  }
}

function result({ rows, written }: { rows: Row[]; written: number }) {
  return { results: rows, success: true, meta: { changes: written, rows_written: written } };
}

export class SqlDatabase {
  constructor(private readonly storage: DurableObjectStorage) {}

  prepare(query: string): Statement {
    return new Statement(this.storage.sql, query);
  }

  /** All or none, as D1 runs a batch. */
  async batch<T>(statements: Statement[]): Promise<D1Result<T>[]> {
    return this.storage.transactionSync(() => statements.map((statement) => result(statement.rows()))) as D1Result<T>[];
  }

  /** Every statement in `script`, all or none, with each one's rows: what the owner's Mac sends (owner.ts). */
  script(script: string): Row[][] {
    return this.storage.transactionSync(() => statements(script).map((query) => this.storage.sql.exec(query).toArray()));
  }

  /** The agent code's view of these tables. */
  get d1(): D1Database {
    return this as unknown as D1Database;
  }
}

/**
 * `script` cut at each `;` outside a quoted string, quoted name or comment, as SQLite reads it. Empty statements are
 * dropped, so a trailing `;` adds nothing.
 */
export function statements(script: string): string[] {
  const found: string[] = [];
  let start = 0;
  let index = 0;
  while (index < script.length) {
    const char = script[index];
    const next = script[index + 1];
    if (char === "'" || char === '"' || char === "`" || char === "[") {
      const close = char === "[" ? "]" : char;
      index = script.indexOf(close, index + 1);
      // A doubled quote inside a string is one quote: the scan goes on past both.
      while (index !== -1 && close !== "]" && script[index + 1] === close) index = script.indexOf(close, index + 2);
      if (index === -1) throw new SyntaxError("unterminated quote in SQL");
    } else if (char === "-" && next === "-") {
      const end = script.indexOf("\n", index);
      index = end === -1 ? script.length : end;
    } else if (char === "/" && next === "*") {
      const end = script.indexOf("*/", index + 2);
      if (end === -1) throw new SyntaxError("unterminated comment in SQL");
      index = end + 1;
    } else if (char === ";") {
      found.push(script.slice(start, index));
      start = index + 1;
    }
    index += 1;
  }
  found.push(script.slice(start));
  return found.map((statement) => statement.trim()).filter((statement) => statement && !/^(--[^\n]*\n?|\/\*[\s\S]*?\*\/|\s)*$/.test(statement));
}
