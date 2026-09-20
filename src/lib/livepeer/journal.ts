import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, open, readFile, rename, stat, unlink, writeFile } from "node:fs/promises";
import path from "node:path";

import { CreativeAPIError } from "./errors";
import type { CreativeJournal } from "./types";

const DEFAULT_JOURNAL: CreativeJournal = { version: 1, estimates: {}, jobs: {}, idempotency: {}, sourceUploads: {} };
const APP_BUDGET_USD = 20;

function journalPath(): string {
  const configured = process.env.LIVEPEER_JOURNAL_PATH?.trim();
  if (process.env.NODE_ENV === "production") {
    if (!configured || !path.isAbsolute(configured)) {
      throw new CreativeAPIError(503, "creative_persistence_unconfigured", "Creative generation is unavailable until durable storage is configured.");
    }
    return configured;
  }
  return configured && path.isAbsolute(configured) ? configured : path.join(process.cwd(), ".creative-data", "journal.json");
}

export function hasDurableJournalConfiguration(): boolean {
  try {
    journalPath();
    return true;
  } catch {
    return false;
  }
}

export function creativeBudgetLimitUsd(): number {
  const value = Number(process.env.LIVEPEER_CREATIVE_BUDGET_USD ?? APP_BUDGET_USD);
  return Number.isFinite(value) && value > 0 && value <= APP_BUDGET_USD ? value : APP_BUDGET_USD;
}

async function readJournal(): Promise<CreativeJournal> {
  const file = journalPath();
  try {
    const parsed = JSON.parse(await readFile(file, "utf8")) as Partial<CreativeJournal>;
    if (parsed.version !== 1 || !parsed.estimates || !parsed.jobs || !parsed.idempotency) throw new Error("invalid");
    return { ...parsed, sourceUploads: parsed.sourceUploads ?? {} } as CreativeJournal;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return structuredClone(DEFAULT_JOURNAL);
    if (error instanceof CreativeAPIError) throw error;
    throw new CreativeAPIError(503, "creative_persistence_unavailable", "Creative generation storage could not be read.");
  }
}

async function acquireLock(lockPath: string): Promise<() => Promise<void>> {
  await mkdir(path.dirname(lockPath), { recursive: true });
  const started = Date.now();
  while (Date.now() - started < 5_000) {
    try {
      const handle = await open(lockPath, "wx");
      await handle.writeFile(`${process.pid}\n`, "utf8");
      await handle.close();
      return async () => { await unlink(lockPath).catch(() => undefined); };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const info = await stat(lockPath);
        if (Date.now() - info.mtimeMs > 30_000) {
          let ownerAlive = false;
          try {
            const ownerPID = Number((await readFile(lockPath, "utf8")).trim());
            if (Number.isInteger(ownerPID) && ownerPID > 0) {
              try {
                process.kill(ownerPID, 0);
                ownerAlive = true;
              } catch (ownerError) {
                ownerAlive = (ownerError as NodeJS.ErrnoException).code !== "ESRCH";
              }
            }
          } catch {
            // A malformed or unreadable stale lock has no live owner to protect.
          }
          if (!ownerAlive) await unlink(lockPath);
        }
      } catch {
        // A concurrent writer may have released the lock between stat/unlink.
      }
      await new Promise((resolve) => setTimeout(resolve, 40));
    }
  }
  throw new CreativeAPIError(503, "creative_persistence_busy", "Creative generation storage is busy; try again.");
}

async function writeJournal(journal: CreativeJournal): Promise<void> {
  const file = journalPath();
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(journal)}\n`, { encoding: "utf8", mode: 0o600 });
  await rename(temporary, file);
}

export async function withJournal<T>(mutate: (journal: CreativeJournal) => Promise<T> | T): Promise<T> {
  const file = journalPath();
  const release = await acquireLock(`${file}.lock`);
  try {
    const journal = await readJournal();
    const value = await mutate(journal);
    await writeJournal(journal);
    return value;
  } finally {
    await release();
  }
}

export async function readJournalSnapshot(): Promise<CreativeJournal> {
  return readJournal();
}

export function budgetSnapshot(journal: CreativeJournal): { spentUsd: number; reservedUsd: number; availableUsd: number } {
  let spentUsd = 0;
  let reservedUsd = 0;
  for (const job of Object.values(journal.jobs)) {
    if (job.reservationState === "held") reservedUsd += job.reservationUsd;
    if (job.actualCostUsd !== undefined) spentUsd += job.actualCostUsd;
    else if (job.reservationState === "settled") spentUsd += job.reservationUsd;
  }
  const availableUsd = Math.max(0, creativeBudgetLimitUsd() - spentUsd - reservedUsd);
  return { spentUsd, reservedUsd, availableUsd };
}

export function assertBudgetAvailable(journal: CreativeJournal, amountUsd: number): void {
  if (budgetSnapshot(journal).availableUsd + 1e-9 < amountUsd) {
    throw new CreativeAPIError(429, "creative_budget_exhausted", "The creative generation budget is reserved or exhausted.");
  }
}
