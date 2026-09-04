"use client";

import { ChangeEvent, DragEvent, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useDraggablePhoto } from "@/components/storefront/photo-drag";
import { PrintFrame } from "@/components/ui";
import { cn } from "@/lib/cn";
import {
  coverOverlayRect,
  faceDebugBadge,
  type FaceDebugEntry,
  type FaceDebugMap,
} from "@/lib/storefront/debug-flags";
import {
  createBrowserPhotos,
  filesFromPhotoFolder,
  rememberedPhotoFolderHandle,
  rememberPhotoFolderHandle,
  type BrowserPhoto,
  type PhotoLibraryAction,
  type PhotoLibraryState,
} from "@/lib/storefront/photo-library";
import { fetchStarterPhotoFiles } from "@/lib/storefront/starter-photos";

type TrayPhotoCardProps = {
  disabled: boolean;
  /** The shopper-facing local face-detection result for this photograph. */
  faceDetection?: FaceDebugEntry;
  /** Present only under the localhost-gated `?debug=faces` overlay. */
  faceDebug?: FaceDebugEntry;
  onSelect: () => void;
  ordinal: number;
  photo: BrowserPhoto;
  selected: boolean;
};

/** The aspect of the tray thumbnail window, as handed to `PrintFrame`. */
const TRAY_THUMBNAIL_ASPECT = 4 / 5;

function percentageBox(rect: { left: number; top: number; width: number; height: number }) {
  return {
    left: `${rect.left}%`,
    top: `${rect.top}%`,
    width: `${rect.width}%`,
    height: `${rect.height}%`,
  };
}

/**
 * The developer-only face overlay for one thumbnail.
 *
 * Deliberately garish and deliberately unstyled by the design system: magenta
 * and lime read at a glance as "this is a tool, not the storefront". It is
 * inert — `pointer-events-none` throughout — so selecting, the drag grip and
 * dnd all behave exactly as they do with the overlay off.
 */
function FaceDebugLayer({ entry, sourceAspectRatio }: { entry: FaceDebugEntry; sourceAspectRatio: number | null }) {
  const mapped = sourceAspectRatio === null
    ? []
    : entry.faces.map((face) => ({ face, rect: coverOverlayRect(face, sourceAspectRatio, TRAY_THUMBNAIL_ASPECT) }));
  const subject = sourceAspectRatio === null || !entry.subject
    ? null
    : coverOverlayRect(entry.subject, sourceAspectRatio, TRAY_THUMBNAIL_ASPECT);
  return <span
    aria-hidden="true"
    className="pointer-events-none absolute inset-0 block overflow-hidden"
    data-face-debug={entry.state}
  >
    {subject ? <span
      className="absolute block border border-dotted border-[#39ff14]"
      style={percentageBox(subject)}
    /> : null}
    {mapped.map(({ face, rect }, index) => rect === null ? null : <span
      className="absolute block border-2 border-dashed border-[#ff00c8]"
      key={index}
      style={percentageBox(rect)}
    >
      <span className="absolute left-0 top-0 bg-black/70 px-0.5 font-mono text-[9px] leading-[1.2] text-[#ff00c8]">
        {face.confidence.toFixed(2)}
      </span>
    </span>)}
    <span className="absolute bottom-1 right-1 rounded bg-black/75 px-1 py-px font-mono text-[10px] leading-[1.4] text-[#ff00c8]">
      {faceDebugBadge(entry)}
    </span>
  </span>;
}

/**
 * A quiet, useful readout of the local detector's completed result. A missing
 * badge is deliberate while detection is pending or unavailable: showing a
 * zero then would claim the browser had examined the photograph when it has
 * not. The number caps visually at 3+ while the accessible label stays exact.
 */
function FaceDetectionBadge({ entry }: { entry: FaceDebugEntry | undefined }) {
  if (!entry || entry.state === "pending" || entry.state === "unavailable") return null;
  const count = entry.faces.length;
  const label = count === 0 ? "No faces detected" : `${count} ${count === 1 ? "face" : "faces"} detected`;
  return <span
    aria-label={label}
    className={cn(
      "pointer-events-none absolute bottom-2 left-2 z-[3] inline-flex items-center gap-1 rounded-full border px-1.5 py-1 text-[11px] font-semibold leading-none shadow-warm",
      count > 0
        ? "border-primary/40 bg-card/95 text-foreground"
        : "border-border-strong bg-card/90 text-muted-foreground",
    )}
    role="img"
    title={label}
  >
    <span>{count > 3 ? "3+" : count}</span>
    <svg aria-hidden="true" className="size-3" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20c.35-3.35 3.2-5.75 6.5-5.75s6.15 2.4 6.5 5.75" />
    </svg>
  </span>;
}

/**
 * One tray photograph: a click selects it, and a drag carries it to a print
 * slot.
 *
 * The two share the thumbnail without fighting because the pointer sensor only
 * activates after the pointer has travelled, so a press that stays put is still
 * a click. Keyboard dragging lives on its own handle instead, since Space on
 * the thumbnail must keep selecting.
 */
function TrayPhotoCard({ disabled, faceDetection, faceDebug, onSelect, ordinal, photo, selected }: TrayPhotoCardProps) {
  const { bodyProps, connect, connectHandle, handleProps, isDragging } = useDraggablePhoto(photo, disabled);
  // The thumbnail crops with object-cover, so placing a box normalised to the
  // photograph needs the photograph's own aspect. Measured from the element
  // that is already on screen rather than by decoding the file a second time.
  const [sourceAspectRatio, setSourceAspectRatio] = useState<number | null>(null);
  const measure = (node: HTMLImageElement | null) => {
    if (!node || !node.complete || node.naturalWidth <= 0 || node.naturalHeight <= 0) return;
    const aspect = node.naturalWidth / node.naturalHeight;
    setSourceAspectRatio((current) => current === aspect ? current : aspect);
  };
  return <li className="w-44 shrink-0">
    <div className="group relative">
      <PrintFrame
        aspect="4 / 5"
        className={cn(
          "w-full transition-opacity duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none",
          selected && "ring-2 ring-primary ring-offset-2 ring-offset-card",
          isDragging && "opacity-40",
        )}
        innerClassName="bg-surface-warm"
        ref={connect}
        rotate
      >
        <button
          aria-current={selected ? "true" : undefined}
          aria-label={`Select image ${ordinal}: ${photo.filename}`}
          className={cn(
            "block size-full cursor-grab active:cursor-grabbing disabled:cursor-not-allowed disabled:opacity-60",
            faceDebug && "relative",
          )}
          disabled={disabled}
          onClick={onSelect}
          // The tray scrolls horizontally by touch, so the body deliberately
          // keeps its default touch-action. Touch dragging starts on the grip.
          onPointerDown={bodyProps.onPointerDown}
          type="button"
        >
          {/* Object URLs are browser-local and intentionally not optimized through a remote loader. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            alt=""
            className="size-full object-cover"
            draggable={false}
            onLoad={faceDebug ? (event) => measure(event.currentTarget) : undefined}
            ref={faceDebug ? measure : undefined}
            src={photo.previewURL}
          />
          {faceDebug ? <FaceDebugLayer entry={faceDebug} sourceAspectRatio={sourceAspectRatio} /> : null}
        </button>
      </PrintFrame>
      {disabled ? null : <button
        aria-label={`Drag image ${ordinal}, ${photo.filename}, onto a print slot`}
        className="pointer-events-none absolute -left-2 -top-2 grid size-6 cursor-grab touch-none place-items-center rounded-full border border-border bg-card text-muted-foreground opacity-0 shadow-warm transition-[color,opacity] hover:text-foreground group-hover:pointer-events-auto group-hover:opacity-100 group-focus-within:pointer-events-auto group-focus-within:opacity-100 focus:pointer-events-auto focus:opacity-100 active:cursor-grabbing motion-reduce:transition-none"
        ref={connectHandle}
        type="button"
        {...handleProps}
      >
        <svg aria-hidden="true" className="size-3" fill="currentColor" viewBox="0 0 24 24">
          <circle cx="9" cy="5" r="2" /><circle cx="15" cy="5" r="2" />
          <circle cx="9" cy="12" r="2" /><circle cx="15" cy="12" r="2" />
          <circle cx="9" cy="19" r="2" /><circle cx="15" cy="19" r="2" />
        </svg>
      </button>}
      {selected ? <span
        aria-hidden="true"
        className="absolute -right-2 -top-2 grid size-6 place-items-center rounded-full bg-primary text-primary-foreground shadow-warm"
      >
        <svg className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.4} viewBox="0 0 24 24">
          <path d="m5 12.5 4.5 4.5L19 7" />
        </svg>
      </span> : null}
      <FaceDetectionBadge entry={faceDetection} />
    </div>

    <div className="mt-3">
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-[13px] text-muted-foreground">{String(ordinal).padStart(2, "0")}</span>
        <b className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground" title={photo.filename}>{photo.filename}</b>
      </div>
      {photo.relativePath ? <p className="mt-1 truncate font-mono text-[13px] text-muted-foreground" title={photo.relativePath}>{photo.relativePath}</p> : null}
    </div>
  </li>;
}

export type PhotoTrayProps = {
  library: PhotoLibraryState;
  onAction: (action: PhotoLibraryAction) => void;
  disabled?: boolean;
  className?: string;
  onImportError?: (message: string) => void;
  /** Finished local face-detection results, by photo id, for thumbnail badges. */
  faceDetection?: FaceDebugMap;
  /**
   * Face boxes to draw over the thumbnails, by photo id. Supplied only when the
   * localhost-gated `?debug=faces` overlay is on; left undefined the tray
   * renders exactly as it always has. This never triggers detection — it shows
   * what the existing lazy pass has already found.
   */
  faceDebug?: FaceDebugMap;
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

export function PhotoTray({ library, onAction, disabled = false, className, onImportError, faceDetection, faceDebug }: PhotoTrayProps) {
  const [dropActive, setDropActive] = useState(false);
  const [error, setError] = useState("");
  const [edgeFade, setEdgeFade] = useState({ left: false, right: false });
  const [facesOnly, setFacesOnly] = useState(false);
  const imageInputID = useId();
  const folderInputID = useId();
  const folderInput = useRef<HTMLInputElement>(null);
  const scroller = useRef<HTMLOListElement>(null);
  // A fresh demo is seeded only when a previously permitted folder is absent.
  // If the shopper picks or drops files while that async check is underway,
  // their own tray wins and the starter set never replaces it.
  const shopperReplacedTray = useRef(false);
  const hasPhotos = library.photos.length > 0;
  const faceFilter = useMemo(() => {
    const entries = library.photos.map((photo) => faceDetection?.[photo.id]);
    const detected = library.photos.filter((photo) => faceDetection?.[photo.id]?.state === "faces");
    return {
      detected,
      pending: entries.some((entry) => !entry || entry.state === "pending"),
      unavailable: entries.length > 0 && entries.every((entry) => entry?.state === "unavailable"),
    };
  }, [faceDetection, library.photos]);
  const visiblePhotos = useMemo(
    () => facesOnly ? faceFilter.detected : library.photos,
    [faceFilter.detected, facesOnly, library.photos],
  );

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const handle = await rememberedPhotoFolderHandle();
        if (handle && handle.queryPermission && await handle.queryPermission({ mode: "read" }) === "granted") {
          const files = await filesFromPhotoFolder(handle);
          if (live && files.length > 0) {
            importFiles(files, "remembered-folder");
            return;
          }
        }
      } catch {
        // A remembered handle is optional browser-local convenience. The file
        // input remains the reliable fallback when permission was revoked.
      }
      try {
        const files = await fetchStarterPhotoFiles();
        if (live) importFiles(files, "starter");
      } catch {
        if (live) setError("Starter photographs could not be loaded. Select files to begin.");
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
  }, [visiblePhotos]);

  function importFiles(files: Iterable<File>, source: "shopper" | "remembered-folder" | "starter" = "shopper") {
    if (source !== "shopper" && shopperReplacedTray.current) return;
    const result = createBrowserPhotos(files);
    // A picker result is the entire local photo set. It must never append to a
    // prior selection, or “image 1” stops meaning what the shopper selected.
    if (result.photos.length > 0) {
      if (source === "shopper") shopperReplacedTray.current = true;
      setFacesOnly(false);
      onAction({ type: "replace", photos: result.photos });
    }
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

  const faceFilterToggle = <button
    aria-pressed={facesOnly}
    className={cn(
      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition-[background-color,border-color,color] duration-200 ease-[var(--ease-out-expo)] motion-reduce:transition-none",
      facesOnly
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border-strong bg-background/60 text-foreground hover:bg-surface-warm",
      faceFilter.unavailable && "cursor-not-allowed opacity-50",
    )}
    disabled={faceFilter.unavailable}
    onClick={() => setFacesOnly((current) => !current)}
    title={faceFilter.unavailable ? "Face detection is unavailable in this browser." : "Show only photographs with detected faces."}
    type="button"
  >
    <svg aria-hidden="true" className="size-3.5" fill="none" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.8} viewBox="0 0 24 24">
      <circle cx="12" cy="8" r="3.25" />
      <path d="M5.5 20c.35-3.35 3.2-5.75 6.5-5.75s6.15 2.4 6.5 5.75" />
    </svg>
    Faces only
    {faceFilter.detected.length > 0 ? <span className={cn("rounded-full px-1.5 py-px text-[11px] leading-none", facesOnly ? "bg-primary-foreground/20" : "bg-surface-warm")}>{faceFilter.detected.length}</span> : null}
  </button>;

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
    {dropActive && !error ? <p className={cn("text-sm text-muted-foreground", hasPhotos ? "px-5 pb-3 sm:px-8 lg:px-12" : "mb-4")}>Release to replace these images.</p> : null}

    {hasPhotos ? <>
      <div className="mx-5 mb-2 flex flex-wrap items-center gap-2 sm:mx-8 lg:mx-12">
        <div className="inline-flex w-fit items-center rounded-full border border-dashed border-border-strong bg-background/60 px-4 py-1.5">
          {pickers}
        </div>
        {faceFilterToggle}
      </div>
      {facesOnly && visiblePhotos.length === 0 ? <div className="px-5 py-6 sm:px-8 lg:px-12">
        <p className="text-sm text-muted-foreground">{faceFilter.pending ? "Scanning photographs for faces…" : "No faces were detected in these photographs."}</p>
        <button className="mt-2 text-sm font-semibold text-primary underline decoration-primary/40 underline-offset-4 hover:decoration-primary" onClick={() => setFacesOnly(false)} type="button">Show all photographs</button>
      </div> : <ol
        aria-label="Loaded photographs"
        className="flex gap-4 overflow-x-auto overscroll-x-contain px-5 py-3 sm:px-8 lg:px-12 [scrollbar-width:thin]"
        ref={scroller}
        style={{
          maskImage: `linear-gradient(to right, ${edgeFade.left ? "transparent" : "#000"} 0, #000 5rem, #000 calc(100% - 5rem), ${edgeFade.right ? "transparent" : "#000"} 100%)`,
          WebkitMaskImage: `linear-gradient(to right, ${edgeFade.left ? "transparent" : "#000"} 0, #000 5rem, #000 calc(100% - 5rem), ${edgeFade.right ? "transparent" : "#000"} 100%)`,
        }}
      >
        {visiblePhotos.map((photo) => <TrayPhotoCard
          disabled={disabled}
          faceDetection={faceDetection?.[photo.id]}
          faceDebug={faceDebug?.[photo.id]}
          key={photo.id}
          onSelect={() => onAction({ type: "select", photoId: photo.id })}
          ordinal={library.photos.indexOf(photo) + 1}
          photo={photo}
          selected={photo.id === library.selectedPhotoId}
        />)}
      </ol>}
    </> : <div className="rounded-[14px] border border-dashed border-border-strong bg-background/60 px-6 py-10 text-center">
      <h2 className="text-base font-semibold text-foreground">No photographs loaded</h2>
      <p className="mt-1 text-sm text-muted-foreground">Start with a folder or one or more JPEG or PNG images.</p>
      <div className="mt-5">{pickers}</div>
    </div>}
  </section>;
}
