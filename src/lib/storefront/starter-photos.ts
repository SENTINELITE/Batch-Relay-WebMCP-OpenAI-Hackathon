/**
 * The photographs that make a fresh storefront immediately usable. They are
 * shipped with the app, then turned into browser-local `File` objects so they
 * follow the exact same tray, crop, and WebMCP paths as a shopper's own files.
 */
export const starterPhotoManifest = [
  "team.jpg",
  "J.jpg",
  "Sabrina.jpg",
  "Chermiti.jpg",
  "Idriss.jpg",
  "Ryan.jpg",
  "Nguyen.jpg",
  "tommy.jpg",
  "Rishab.jpg",
  "logan.jpg",
  "Mahdi.jpg",
  "julian.jpg",
  "kareem.jpg",
  "Devin.jpg",
  "alexy.jpg",
  "logan-2.jpg",
  "Thomas.jpg",
] as const;

export type StarterPhotoResponse = Pick<Response, "ok" | "blob">;

/**
 * A fixed timestamp gives this bundled set stable keys across reloads. That
 * lets saved drafts re-link to the same demo photograph without persisting any
 * image bytes in browser storage.
 */
export async function fetchStarterPhotoFiles(
  fetchPhoto: (source: string) => Promise<StarterPhotoResponse> = (source) => fetch(source),
): Promise<File[]> {
  return Promise.all(starterPhotoManifest.map(async (filename) => {
    const response = await fetchPhoto(`/starter-photos/${filename}`);
    if (!response.ok) throw new Error(`Starter photo ${filename} could not be loaded.`);
    return new File([await response.blob()], filename, { lastModified: 0, type: "image/jpeg" });
  }));
}
