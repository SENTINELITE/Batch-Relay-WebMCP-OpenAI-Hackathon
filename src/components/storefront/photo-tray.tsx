"use client";

import { ChangeEvent, DragEvent, useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { PrintFrame } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  createBrowserPhotos,
  filesFromPhotoFolder,
  rememberedPhotoFolderHandle,
  rememberPhotoFolderHandle,
  type PhotoLibraryAction,
  type PhotoLibraryState,
} from "@/lib/storefront/photo-library";

export type PhotoTrayProps = {
  library: PhotoLibraryState;
  onAction: (action: PhotoLibraryAction) => void;
  disabled?: boolean;
  className?: string;
  onImportError?: (message: string) => void;
};

const hiddenInputStyle = {
  blockSize: 1,
  clip: "rect(0 0 0 0)",
  clipPath: "inset(50%)",
  inlineSize: 1,
  overflow: "hidden",
  position: "absolute" as const,
  whiteSpace: "nowrap" as const,
};

const pickerActionClassName =
  "cursor-pointer text-[15px] font-medium text-foreground underline decoration-border-strong underline-offset-[5px] transition-colors duration-200 ease-[var(--ease-out-expo)] hover:decoration-foreground disabled:cursor-not-allowed disabled:opacity-50 motion-reduce:transition-none";

export function PhotoTray({ library, onAction, disabled = false, className, onImportError }: PhotoTrayProps) {
  const [dropActive, setDropActive] = useState(false);
  const [error, setError] = useState("");
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false });
  const imageInputID = useId();
  const folderInputID = useId();
  const folderInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLOListElement>(null);
  const hasPhotos = library.photos.length > 0;

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const handle = await rememberedPhotoFolderHandle();
        if (!handle || !handle.queryPermission || await handle.queryPermission({ mode: "read" }) !== "granted") return;
        const files = await filesFromPhotoFolder(handle);
        if (live && files.length > 0) importFiles(files);
      } catch {
        // A remembered handle is optional browser-local convenience. The file
        // input remains the reliable fallback when permission was revoked.
      }
    })();
    return () => { live = false; };
  // Importing once per mount is intentional; this must not repeatedly append.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useLayoutEffect(() => {
    const node = scroller.current;
    if (!node) {
      setEdgeFade({ left: false, right: false });
      return;
    }
    const update = () => {
      const next = {
        left: node.scrollLeft > 4,
        right: node.scrollLeft + node.clientWidth < node.scrollWidth - 4,
      };
      setEdgeFade((current) => current.left === next.left && current.right === next.right ? current : next);
    };
    update();
    const frame = requestAnimationFrame(update);
    node.addEventListener("scroll", update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(node);
    for (const child of node.children) observer.observe(child);
    return () => {
      cancelAnimationFrame(frame);
      node.removeEventListener("scroll", update);
      observer.disconnect();
    };
  }, [library.photos]);

  function importFiles(files: Iterable<File>) {
    const result = createBrowserPhotos(files);
    if (result.photos.length > 0) onAction({ type: "add", photos: result.photos });
    const message = result.rejected.map(({ message: reason }) => reason).join(" ");
    setError(message);
    if (message) onImportError?.(message);
  }

  function onFileChange(event: ChangeEvent<HTMLInputElement>) {
    if (event.target.files) importFiles(event.target.files);
    event.target.value = "";
  }

  function onDrop(event: DragEvent<HTMLElement>) {
    event.preventDefault();
    setDropActive(false);
    if (!disabled && event.dataTransfer.files.length > 0) importFiles(event.dataTransfer.files);
  }

  async function chooseFolder() {
    const pickerWindow = window as Window & { showDirectoryPicker?: () => Promise<unknown> };
    if (!pickerWindow.showDirectoryPicker) {
      folderInput.current?.click();
      return;
    }
    try {
      const handle = await pickerWindow.showDirectoryPicker() as Parameters<typeof rememberPhotoFolderHandle>[0];
      importFiles(await filesFromPhotoFolder(handle));
      // Remembering the folder is optional. A storage failure must not block
      // the photos the user has just chosen.
      void rememberPhotoFolderHandle(handle).catch(() => {});
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === "AbortError") return;
      const message = "That folder could not be read.";
      setError(message);
      onImportError?.(message);
    }
  }

  const fileInputs = <>
    <input accept="image/jpeg,image/png,.jpg,.jpeg,.png" id={imageInputID} multiple onChange={onFileChange} style={hiddenInputStyle} type="file" />
    <input
      accept="image/jpeg,image/png,.jpg,.jpeg,.png"
      id={folderInputID}
      multiple
      onChange={onFileChange}
      ref={(node) => {
        folderInput.current = node;
        if (!node) return;
        node.setAttribute("webkitdirectory", "");
        node.setAttribute("directory", "");
        const directoryInput = node as HTMLInputElement & { webkitdirectory?: boolean };
        if ("webkitdirectory" in directoryInput) directoryInput.webkitdirectory = true;
      }}
      style={hiddenInputStyle}
      type="file"
    />
  </>;

  const pickers = <div className="flex flex-wrap items-center justify-center gap-x-4 gap-y-2">
    <label className={cn(pickerActionClassName, disabled && "pointer-events-none opacity-50")} htmlFor={imageInputID}>Select files</label>
    <span aria-hidden="true" className="text-muted-foreground">/</span>
    <button className={pickerActionClassName} disabled={disabled} onClick={() => void chooseFolder()} type="button">Select folder</button>
  </div>;

  return <section
    aria-label="Photo tray"
    className={cn(
      "relative w-full transition-[background-color,border-color] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none",
      hasPhotos ? "py-4" : "px-5 py-5 sm:px-8 sm:py-6 lg:px-12",
      dropActive ? "border-b-2 border-dashed border-primary bg-surface-warm" : "border-b border-border bg-card",
      className,
    )}
    onDragEnter={(event) => { event.preventDefault(); if (!disabled) setDropActive(true); }}
    onDragOver={(event) => event.preventDefault()}
    onDragLeave={(event) => { if (event.currentTarget === event.target) setDropActive(false); }}
    onDrop={onDrop}
  >
    {fileInputs}

    {error ? <p aria-live="polite" className={cn("text-sm text-status-error", hasPhotos ? "px-5 pb-3 sm:px-8 lg:px-12" : "mb-4")}>{error}</p> : null}
    {dropActive && !error ? <p className={cn("text-sm text-muted-foreground", hasPhotos ? "px-5 pb-3 sm:px-8 lg:px-12" : "mb-4")}>Release to add these images.</p> : null}

    {hasPhotos ? <>
      <div className="mx-5 mb-2 inline-flex w-fit items-center rounded-full border border-dashed border-border-strong bg-background/60 px-4 py-1.5 sm:mx-8 lg:mx-12">
        {pickers}
      </div>
      <ol
        aria-label="Loaded photographs"
        className="flex gap-4 overflow-x-auto overscroll-x-contain px-5 py-3 sm:px-8 lg:px-12 [scrollbar-width:thin]"
        ref={scroller}
        style={{
          maskImage: `linear-gradient(to right, ${edgeFade.left ? "transparent" : "#000"} 0, #000 5rem, #000 calc(100% - 5rem), ${edgeFade.right ? "transparent" : "#000"} 100%)`,
          WebkitMaskImage: `linear-gradient(to right, ${edgeFade.left ? "transparent" : "#000"} 0, #000 5rem, #000 calc(100% - 5rem), ${edgeFade.right ? "transparent" : "#000"} 100%)`,
        }}
      >
        {library.photos.map((photo, index) => {
          const ordinal = index + 1;
          const selected = photo.id === library.selectedPhotoId;
          return <li className="w-44 shrink-0" key={photo.id}>
            <div className="relative">
              <PrintFrame
                aspect="4 / 5"
                className={cn("w-full", selected && "ring-2 ring-primary ring-offset-2 ring-offset-card")}
                innerClassName="bg-surface-warm"
                rotate
              >
                <button
                  aria-current={selected ? "true" : undefined}
                  aria-label={`Select image ${ordinal}: ${photo.filename}`}
                  className="block size-full cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
                  disabled={disabled}
                  onClick={() => onAction({ type: "select", photoId: photo.id })}
                  type="button"
                >
                  {/* Object URLs are browser-local and intentionally not optimized through a remote loader. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img alt="" className="size-full object-cover" src={photo.previewURL} />
                </button>
              </PrintFrame>
              {selected ? <span
                aria-hidden="true"
                className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-warm"
              >
                <svg className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} viewBox="0 0 24 24">
                  <path d="m5 12.5 4.5 4.5L19 7" />
                </svg>
              </span> : null}
            </div>

            <div className="mt-3">
              <div className="flex items-baseline gap-2">
                <span className="font-mono text-[13px] text-muted-foreground">{String(ordinal).padStart(2, "0")}</span>
                <b className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={photo.filename}>{photo.filename}</b>
              </div>
              {photo.relativePath ? <p className="mt-1 truncate font-mono text-[13px] text-muted-foreground" title={photo.relativePath}>{photo.relativePath}</p> : null}
            </div>
          </li>;
        })}
      </ol>
    </> : <div className="rounded-[14px] border border-dashed border-border-strong bg-background/60 px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-foreground">No photographs loaded</h2>
      <p className="mt-1 text-sm text-muted-foreground">Start with a folder or one or more JPEG or PNG images.</p>
      <div className="mt-5">{pickers}</div>
    </div>}
  </section>;
}
