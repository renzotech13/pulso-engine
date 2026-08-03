"use client";

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from "react";

interface MediaDropzoneProps {
  name: string;
  accept: string;
  label: string;
  hint: string;
  /** Default true. Set false for a single-file dropzone (e.g. a logo) — a new file replaces the current one instead of accumulating. */
  multiple?: boolean;
  /** Shown as the initial preview when nothing's been picked yet — e.g. the brand kit's already-saved logo. */
  currentPreviewUrl?: string;
}

/**
 * Native file input, driven by drag/drop or click, kept in sync via a
 * reconstructed DataTransfer so the surrounding <form action={serverAction}>
 * still submits the files under `name` — no client-side upload logic here,
 * the Server Action does the actual upload.
 */
export function MediaDropzone({
  name,
  accept,
  label,
  hint,
  multiple = true,
  currentPreviewUrl,
}: MediaDropzoneProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [previewUrls, setPreviewUrls] = useState<string[]>([]);
  const [isDragging, setIsDragging] = useState(false);

  useEffect(() => {
    const urls = files.map((file) => (file.type.startsWith("image/") ? URL.createObjectURL(file) : ""));
    setPreviewUrls(urls);
    return () => {
      for (const url of urls) if (url) URL.revokeObjectURL(url);
    };
  }, [files]);

  function syncInput(next: File[]) {
    const dataTransfer = new DataTransfer();
    for (const file of next) dataTransfer.items.add(file);
    if (inputRef.current) inputRef.current.files = dataTransfer.files;
    setFiles(next);
  }

  function addFiles(list: FileList | null) {
    if (!list || list.length === 0) return;
    syncInput(multiple ? [...files, ...Array.from(list)] : [list[0]!]);
  }

  function removeFile(index: number) {
    syncInput(files.filter((_, i) => i !== index));
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    addFiles(event.dataTransfer.files);
  }

  return (
    <div>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-wide text-neutral-500">
        {label}
      </label>
      <div
        role="button"
        tabIndex={0}
        onDragOver={(event) => {
          event.preventDefault();
          setIsDragging(true);
        }}
        onDragLeave={() => setIsDragging(false)}
        onDrop={handleDrop}
        onClick={() => inputRef.current?.click()}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") inputRef.current?.click();
        }}
        className={`cursor-pointer rounded-xl border-2 border-dashed px-4 py-5 text-center transition-colors duration-300 ease-in-out focus-visible:outline focus-visible:outline-2 focus-visible:outline-pulso-accent ${
          isDragging
            ? "animate-pulse-ring border-pulso-primary bg-pulso-primary/10"
            : "border-ink-700 hover:border-pulso-accent/60 hover:bg-ink-800"
        }`}
      >
        {files.length === 0 && currentPreviewUrl && (
          <img
            src={currentPreviewUrl}
            alt=""
            className="mx-auto mb-2 h-12 w-12 rounded object-cover"
          />
        )}
        <p className="text-sm text-neutral-400">{hint}</p>
        <input
          ref={inputRef}
          type="file"
          name={name}
          accept={accept}
          multiple={multiple}
          className="hidden"
          onChange={(event: ChangeEvent<HTMLInputElement>) => addFiles(event.target.files)}
        />
      </div>
      {files.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-2">
          {files.map((file, index) => (
            <li
              key={`${file.name}-${index}`}
              className="flex items-center gap-2 rounded-lg border border-ink-700 bg-ink-800 px-2 py-1 text-xs text-neutral-300"
            >
              {previewUrls[index] ? (
                <img src={previewUrls[index]} alt="" className="h-6 w-6 rounded object-cover" />
              ) : (
                <span aria-hidden>🎬</span>
              )}
              <span className="max-w-[10rem] truncate">{file.name}</span>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  removeFile(index);
                }}
                className="text-neutral-500 hover:text-status-pink"
                aria-label={`Quitar ${file.name}`}
              >
                ×
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
