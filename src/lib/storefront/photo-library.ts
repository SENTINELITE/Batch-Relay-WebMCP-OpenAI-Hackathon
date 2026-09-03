/**
 * Browser-local photographs are intentionally separate from managed assets.
 * A photo's id survives sorting and selection changes, while its ordinal is
 * always derived from its current position in the tray.
 */
export type BrowserPhoto = {
  id: string;
  file: File;
  filename: string;
  relativePath?: string;
  previewURL: string;
  mimeType: "image/jpeg" | "image/png";
  byteSize: number;
};

export type PhotoTarget = {
  productId: string;
  productRevision: number;
  templateId?: string;
  templateRevisionId?: string;
  slotKey?: string;
};

export type PhotoPreparation = {
  status: "idle" | "preparing" | "ready" | "error";
  managedAssetId?: string;
  preparedFilename?: string;
  error?: string;
};

export type PhotoLibraryState = {
  photos: BrowserPhoto[];
  selectedPhotoId: string | null;
  revision: number;
  preparations: Record<string, PhotoPreparation>;
};

export type PhotoLibraryAction =
  | { type: "add"; photos: BrowserPhoto[] }
  | { type: "remove"; photoId: string }
  | { type: "move"; photoId: string; direction: "earlier" | "later" }
  | { type: "select"; photoId: string | null }
  | { type: "set-preparation"; photoId: string; target: PhotoTarget; preparation: PhotoPreparation }
  | { type: "clear" };

export const emptyPhotoLibrary = (): PhotoLibraryState => ({
  photos: [],
  selectedPhotoId: null,
  revision: 0,
  preparations: {},
});

export const photoOrdinal = (photos: readonly BrowserPhoto[], photoId: string): number | null => {
  const index = photos.findIndex((photo) => photo.id === photoId);
  return index < 0 ? null : index + 1;
};

/**
 * Preparation state is scoped to both a particular local photo and its exact
 * output target. A portrait prepared for one slot must never be reused by a
 * different template slot by accident.
 */
export const photoPreparationKey = (photoId: string, target: PhotoTarget): string => JSON.stringify([
  photoId,
  target.productId,
  target.productRevision,
  target.templateId ?? null,
  target.templateRevisionId ?? null,
  target.slotKey ?? null,
]);

export function photoLibraryReducer(state: PhotoLibraryState, action: PhotoLibraryAction): PhotoLibraryState {
  switch (action.type) {
    case "add": {
      const knownIDs = new Set(state.photos.map((photo) => photo.id));
      const additions = action.photos.filter((photo) => !knownIDs.has(photo.id));
      if (additions.length === 0) return state;
      return {
        ...state,
        photos: [...state.photos, ...additions],
        selectedPhotoId: state.selectedPhotoId ?? additions[0].id,
        revision: state.revision + 1,
      };
    }
    case "remove": {
      const index = state.photos.findIndex((photo) => photo.id === action.photoId);
      if (index < 0) return state;
      const photos = state.photos.filter((photo) => photo.id !== action.photoId);
      const preparations = Object.fromEntries(Object.entries(state.preparations)
        .filter(([key]) => !key.startsWith(`${JSON.stringify([action.photoId]).slice(0, -1)},`)));
      const selectedPhotoId = state.selectedPhotoId !== action.photoId
        ? state.selectedPhotoId
        : (photos[index]?.id ?? photos[index - 1]?.id ?? null);
      return { ...state, photos, selectedPhotoId, preparations, revision: state.revision + 1 };
    }
    case "move": {
      const index = state.photos.findIndex((photo) => photo.id === action.photoId);
      const destination = action.direction === "earlier" ? index - 1 : index + 1;
      if (index < 0 || destination < 0 || destination >= state.photos.length) return state;
      const photos = [...state.photos];
      [photos[index], photos[destination]] = [photos[destination], photos[index]];
      return { ...state, photos, revision: state.revision + 1 };
    }
    case "select":
      if (action.photoId !== null && !state.photos.some((photo) => photo.id === action.photoId)) return state;
      return action.photoId === state.selectedPhotoId ? state : { ...state, selectedPhotoId: action.photoId };
    case "set-preparation": {
      if (!state.photos.some((photo) => photo.id === action.photoId)) return state;
      const key = photoPreparationKey(action.photoId, action.target);
      return { ...state, preparations: { ...state.preparations, [key]: action.preparation } };
    }
    case "clear":
      return emptyPhotoLibrary();
  }
}

export type PhotoReferenceResolution =
  | { kind: "resolved"; photo: BrowserPhoto; ordinal: number }
  | { kind: "ambiguous"; reference: string; matches: BrowserPhoto[] }
  | { kind: "missing"; reference: string };

const ordinalWords: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5,
  sixth: 6, seventh: 7, eighth: 8, ninth: 9, tenth: 10,
};

function requestedOrdinal(reference: string | number): number | null {
  if (typeof reference === "number") return Number.isInteger(reference) && reference > 0 ? reference : null;
  const normalized = reference.trim().toLowerCase();
  if (/^\d+$/.test(normalized)) return Number(normalized);
  const match = normalized.match(/^(?:the )?(?:(first|second|third|fourth|fifth|sixth|seventh|eighth|ninth|tenth)|(?:image|photo)\s+(\d+))(?:\s+(?:image|photo))?$/);
  if (!match) return null;
  return match[1] ? ordinalWords[match[1]] : Number(match[2]);
}

/** Resolve exactly one currently visible photo; duplicate filenames fail closed. */
export function resolvePhotoReference(photos: readonly BrowserPhoto[], reference: string | number): PhotoReferenceResolution {
  const raw = String(reference).trim();
  const ordinal = requestedOrdinal(reference);
  if (ordinal !== null) {
    const photo = photos[ordinal - 1];
    return photo ? { kind: "resolved", photo, ordinal } : { kind: "missing", reference: raw };
  }
  const idMatch = photos.find((photo) => photo.id === raw);
  if (idMatch) return { kind: "resolved", photo: idMatch, ordinal: photos.indexOf(idMatch) + 1 };
  const normalizedName = raw.toLocaleLowerCase();
  const matches = photos.filter((photo) => photo.filename.toLocaleLowerCase() === normalizedName);
  if (matches.length === 1) return { kind: "resolved", photo: matches[0], ordinal: photos.indexOf(matches[0]) + 1 };
  if (matches.length > 1) return { kind: "ambiguous", reference: raw, matches };
  return { kind: "missing", reference: raw };
}

export type PhotoImportResult = {
  photos: BrowserPhoto[];
  rejected: Array<{ file: File; message: string }>;
};

const ignoredImportBasenames = new Set([".ds_store"]);

/** Folder drops include macOS metadata that is not a photograph. Skip it. */
export const isIgnoredImportFile = (file: Pick<File, "name">): boolean => {
  const basename = file.name.split(/[\\/]/).pop()?.toLowerCase() ?? "";
  return ignoredImportBasenames.has(basename) || basename.startsWith("._");
};

export const isSupportedImageFile = (file: Pick<File, "name" | "type">): boolean => {
  const type = file.type.toLowerCase();
  const extension = file.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  const jpeg = type === "image/jpeg" || (!type && (extension === "jpg" || extension === "jpeg"));
  const png = type === "image/png" || (!type && extension === "png");
  return jpeg || png;
};

export const imageValidationError = (file: Pick<File, "name" | "type" | "size">): string | null => {
  if (!isSupportedImageFile(file)) return `${file.name || "This file"} is not a JPEG or PNG.`;
  if (file.size <= 0) return `${file.name || "This file"} is empty.`;
  return null;
};

export type CreateBrowserPhotosOptions = {
  idFactory?: () => string;
  createObjectURL?: (file: File) => string;
};

const opaquePhotoID = (): string => `photo_${crypto.randomUUID()}`;

export function createBrowserPhotos(files: Iterable<File>, options: CreateBrowserPhotosOptions = {}): PhotoImportResult {
  const idFactory = options.idFactory ?? opaquePhotoID;
  const createObjectURL = options.createObjectURL ?? ((file: File) => URL.createObjectURL(file));
  const photos: BrowserPhoto[] = [];
  const rejected: PhotoImportResult["rejected"] = [];
  for (const file of files) {
    if (isIgnoredImportFile(file)) continue;
    // Folder pickers commonly include exports and metadata beside photos. The
    // demo only displays JPEGs and PNGs, so skip every other file quietly.
    if (!isSupportedImageFile(file)) continue;
    const message = imageValidationError(file);
    if (message) {
      rejected.push({ file, message });
      continue;
    }
    const mimeType = file.type.toLowerCase() === "image/png" || (!file.type && file.name.toLowerCase().endsWith(".png"))
      ? "image/png"
      : "image/jpeg";
    const relativePath = "webkitRelativePath" in file && typeof file.webkitRelativePath === "string" && file.webkitRelativePath
      ? file.webkitRelativePath
      : undefined;
    photos.push({
      id: idFactory(),
      file,
      filename: file.name,
      relativePath,
      previewURL: createObjectURL(file),
      mimeType,
      byteSize: file.size,
    });
  }
  return { photos, rejected };
}

/** Injectable revoker keeps cleanup explicit and testable. */
export function revokePhotoObjectURLs(photos: Iterable<Pick<BrowserPhoto, "previewURL">>, revoke: (url: string) => void = URL.revokeObjectURL): void {
  for (const photo of photos) revoke(photo.previewURL);
}

// Folder handles are permission-backed browser capabilities.  We persist only
// the handle, never the image files or bytes; the ordinary folder input stays
// available for browsers that do not support this API.
type DirectoryHandle = {
  queryPermission?: (descriptor?: { mode?: "read" }) => Promise<PermissionState>;
  values: () => AsyncIterable<{ kind: "file" | "directory"; getFile?: () => Promise<File>; values?: () => AsyncIterable<unknown> }>;
};

const folderDatabaseName = "batchrelay-storefront";
const folderStoreName = "folder-handles";
const lastFolderHandleKey = "last-photo-folder";

function folderDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(folderDatabaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(folderStoreName);
    request.onerror = () => reject(request.error ?? new Error("The browser could not open its local folder-handle store."));
    request.onsuccess = () => resolve(request.result);
  });
}

export async function rememberPhotoFolderHandle(handle: DirectoryHandle): Promise<void> {
  const database = await folderDatabase();
  await new Promise<void>((resolve, reject) => {
    const transaction = database.transaction(folderStoreName, "readwrite");
    transaction.objectStore(folderStoreName).put(handle, lastFolderHandleKey);
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error ?? new Error("The folder handle could not be remembered."));
  }).finally(() => database.close());
}

export async function rememberedPhotoFolderHandle(): Promise<DirectoryHandle | null> {
  const database = await folderDatabase();
  return new Promise<DirectoryHandle | null>((resolve, reject) => {
    const transaction = database.transaction(folderStoreName, "readonly");
    const request = transaction.objectStore(folderStoreName).get(lastFolderHandleKey);
    request.onsuccess = () => resolve((request.result as DirectoryHandle | undefined) ?? null);
    request.onerror = () => reject(request.error ?? new Error("The remembered folder could not be read."));
  }).finally(() => database.close());
}

export async function filesFromPhotoFolder(handle: DirectoryHandle): Promise<File[]> {
  const files: File[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind === "file" && entry.getFile) {
      const file = await entry.getFile();
      if (!isIgnoredImportFile(file)) files.push(file);
    } else if (entry.kind === "directory" && entry.values) {
      files.push(...await filesFromPhotoFolder(entry as DirectoryHandle));
    }
  }
  return files;
}
