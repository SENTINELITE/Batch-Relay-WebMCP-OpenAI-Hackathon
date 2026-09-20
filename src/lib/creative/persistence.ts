import type { CreativeAssetReference, CreativeCutoutCandidate, CreativeProject } from "./types.ts";

export const CREATIVE_DB_NAME = "batch-relay-creative";
export const CREATIVE_DB_VERSION = 1;
export const CREATIVE_PROJECT_STORE = "projects";
export const CREATIVE_BLOB_STORE = "blobs";

export type CreativeBlobMap = Readonly<Record<string, Blob>>;

export type CreativePersistence = {
  saveProject(project: CreativeProject, blobs?: CreativeBlobMap): Promise<void>;
  loadProject(projectId: string): Promise<CreativeProject | null>;
  listProjects(): Promise<CreativeProject[]>;
  saveAssetBlob(blobKey: string, blob: Blob): Promise<void>;
  loadAssetBlob(blobKey: string): Promise<Blob | null>;
  deleteProject(projectId: string): Promise<void>;
};

export function cloneCreativeProject(project: CreativeProject): CreativeProject {
  if (typeof structuredClone === "function") return structuredClone(project);
  return JSON.parse(JSON.stringify(project)) as CreativeProject;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isAssetReference(value: unknown): value is CreativeAssetReference {
  return isRecord(value)
    && typeof value.id === "string"
    && (value.slot === "background" || value.slot === "athlete" || value.slot === "logo")
    && typeof value.name === "string"
    && typeof value.mimeType === "string"
    && typeof value.blobKey === "string";
}

function isCutoutCandidate(value: unknown): value is CreativeCutoutCandidate {
  return isRecord(value)
    && typeof value.id === "string"
    && typeof value.sourceAssetId === "string"
    && typeof value.prompt === "string"
    && typeof value.createdAt === "string"
    && isAssetReference(value.asset)
    && value.asset.slot === "athlete"
    && (value.status === undefined || value.status === "pending" || value.status === "ready" || value.status === "failed");
}

/** A shallow runtime guard prevents a corrupt browser record from reaching UI state. */
export function isCreativeProject(value: unknown): value is CreativeProject {
  if (!isRecord(value)) return false;
  if (typeof value.id !== "string" || typeof value.revision !== "number" || !Number.isInteger(value.revision) || value.revision < 1) return false;
  const event = value.event;
  if (!isRecord(event) || !["name", "date", "location", "callToAction"].every((key) => typeof event[key] === "string")) return false;
  if (!isRecord(value.palette) || typeof value.palette.primary !== "string" || typeof value.palette.accent !== "string") return false;
  if (typeof value.brief !== "string" || (value.format !== "card" && value.format !== "banner")) return false;
  const assets = value.assets;
  const layouts = value.layouts;
  if (!isRecord(assets) || !isRecord(layouts)) return false;
  for (const key of ["background", "athlete", "logo"] as const) {
    const asset = assets[key];
    if (asset !== undefined && !isAssetReference(asset)) return false;
  }
  if (value.athleteOriginal !== undefined && (!isAssetReference(value.athleteOriginal) || value.athleteOriginal.slot !== "athlete")) return false;
  if (value.athleteCutoutCandidates !== undefined && (!Array.isArray(value.athleteCutoutCandidates) || !value.athleteCutoutCandidates.every(isCutoutCandidate))) return false;
  if (!Array.isArray(value.backgroundCandidates) || !Array.isArray(value.generationRefs)) return false;
  if (!isRecord(layouts.card) || !isRecord(layouts.banner) || !Array.isArray(layouts.card.text) || !Array.isArray(layouts.banner.text)) return false;
  return typeof value.createdAt === "string" && typeof value.updatedAt === "string";
}

function validProject(project: CreativeProject): CreativeProject {
  if (!isCreativeProject(project)) throw new Error("Invalid creative project document.");
  return cloneCreativeProject(project);
}

type ProjectRecord = CreativeProject;
type BlobRecord = { blobKey: string; blob: Blob };

function indexedDbOrThrow(factory?: IDBFactory): IDBFactory {
  const value = factory ?? (typeof indexedDB !== "undefined" ? indexedDB : undefined);
  if (!value) throw new Error("IndexedDB is unavailable in this environment.");
  return value;
}

function requestResult<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("IndexedDB request failed."));
  });
}

function transactionDone(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("IndexedDB transaction failed."));
    transaction.onabort = () => reject(transaction.error ?? new Error("IndexedDB transaction aborted."));
  });
}

export function openCreativeDatabase(
  factory?: IDBFactory,
  name = CREATIVE_DB_NAME,
  version = CREATIVE_DB_VERSION,
): Promise<IDBDatabase> {
  const request = indexedDbOrThrow(factory).open(name, version);
  request.onupgradeneeded = () => {
    const database = request.result;
    if (!database.objectStoreNames.contains(CREATIVE_PROJECT_STORE)) database.createObjectStore(CREATIVE_PROJECT_STORE, { keyPath: "id" });
    if (!database.objectStoreNames.contains(CREATIVE_BLOB_STORE)) database.createObjectStore(CREATIVE_BLOB_STORE, { keyPath: "blobKey" });
  };
  return requestResult(request);
}

export function createIndexedDbCreativePersistence(options: {
  factory?: IDBFactory;
  name?: string;
  version?: number;
} = {}): CreativePersistence {
  let databasePromise: Promise<IDBDatabase> | undefined;
  const database = () => databasePromise ??= openCreativeDatabase(options.factory, options.name, options.version);

  return {
    async saveProject(project, blobs = {}) {
      const stored = validProject(project);
      const db = await database();
      const transaction = db.transaction([CREATIVE_PROJECT_STORE, CREATIVE_BLOB_STORE], "readwrite");
      transaction.objectStore(CREATIVE_PROJECT_STORE).put(stored satisfies ProjectRecord);
      for (const [blobKey, blob] of Object.entries(blobs)) {
        transaction.objectStore(CREATIVE_BLOB_STORE).put({ blobKey, blob } satisfies BlobRecord);
      }
      await transactionDone(transaction);
    },

    async loadProject(projectId) {
      const db = await database();
      const record = await requestResult(db.transaction(CREATIVE_PROJECT_STORE, "readonly").objectStore(CREATIVE_PROJECT_STORE).get(projectId)) as unknown;
      return isCreativeProject(record) ? cloneCreativeProject(record) : null;
    },

    async listProjects() {
      const db = await database();
      const records = await requestResult(db.transaction(CREATIVE_PROJECT_STORE, "readonly").objectStore(CREATIVE_PROJECT_STORE).getAll()) as unknown[];
      return records.filter(isCreativeProject).map(cloneCreativeProject);
    },

    async saveAssetBlob(blobKey, blob) {
      if (!blobKey || !(blob instanceof Blob)) throw new Error("A valid blob key and Blob are required.");
      const db = await database();
      const transaction = db.transaction(CREATIVE_BLOB_STORE, "readwrite");
      transaction.objectStore(CREATIVE_BLOB_STORE).put({ blobKey, blob } satisfies BlobRecord);
      await transactionDone(transaction);
    },

    async loadAssetBlob(blobKey) {
      const db = await database();
      const record = await requestResult(db.transaction(CREATIVE_BLOB_STORE, "readonly").objectStore(CREATIVE_BLOB_STORE).get(blobKey)) as unknown;
      if (!isRecord(record) || !(record.blob instanceof Blob)) return null;
      return record.blob;
    },

    async deleteProject(projectId) {
      const db = await database();
      const transaction = db.transaction([CREATIVE_PROJECT_STORE, CREATIVE_BLOB_STORE], "readwrite");
      const projectStore = transaction.objectStore(CREATIVE_PROJECT_STORE);
      const blobStore = transaction.objectStore(CREATIVE_BLOB_STORE);
      const record = await requestResult(projectStore.get(projectId)) as unknown;
      if (isCreativeProject(record)) {
        const keys = new Set<string>();
        for (const asset of Object.values(record.assets)) if (asset?.blobKey) keys.add(asset.blobKey);
        for (const candidate of record.backgroundCandidates) if (candidate.asset.blobKey) keys.add(candidate.asset.blobKey);
        if (record.athleteOriginal?.blobKey) keys.add(record.athleteOriginal.blobKey);
        for (const candidate of record.athleteCutoutCandidates ?? []) if (candidate.asset.blobKey) keys.add(candidate.asset.blobKey);
        for (const key of keys) blobStore.delete(key);
      }
      projectStore.delete(projectId);
      await transactionDone(transaction);
    },
  };
}

/** A deterministic in-memory adapter used by tests and by non-browser previews. */
export function createMemoryCreativePersistence(): CreativePersistence {
  const projects = new Map<string, CreativeProject>();
  const blobs = new Map<string, Blob>();
  return {
    async saveProject(project, entries = {}) {
      projects.set(project.id, validProject(project));
      for (const [key, blob] of Object.entries(entries)) blobs.set(key, blob);
    },
    async loadProject(projectId) {
      const project = projects.get(projectId);
      return project ? cloneCreativeProject(project) : null;
    },
    async listProjects() {
      return [...projects.values()].map(cloneCreativeProject);
    },
    async saveAssetBlob(blobKey, blob) {
      blobs.set(blobKey, blob);
    },
    async loadAssetBlob(blobKey) {
      return blobs.get(blobKey) ?? null;
    },
    async deleteProject(projectId) {
      const project = projects.get(projectId);
      if (project) {
        for (const asset of Object.values(project.assets)) if (asset?.blobKey) blobs.delete(asset.blobKey);
        for (const candidate of project.backgroundCandidates) blobs.delete(candidate.asset.blobKey);
        if (project.athleteOriginal?.blobKey) blobs.delete(project.athleteOriginal.blobKey);
        for (const candidate of project.athleteCutoutCandidates ?? []) blobs.delete(candidate.asset.blobKey);
      }
      projects.delete(projectId);
    },
  };
}

export async function saveCreativeProject(
  project: CreativeProject,
  blobs: CreativeBlobMap = {},
  persistence = createIndexedDbCreativePersistence(),
): Promise<void> {
  await persistence.saveProject(project, blobs);
}

export async function loadCreativeProject(
  projectId: string,
  persistence = createIndexedDbCreativePersistence(),
): Promise<CreativeProject | null> {
  return persistence.loadProject(projectId);
}
