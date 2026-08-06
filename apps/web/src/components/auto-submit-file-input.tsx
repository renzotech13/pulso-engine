"use client";

import type { InputHTMLAttributes } from "react";

/** A file input that submits its enclosing form as soon as a file is picked — no separate "upload" button click needed. */
export function AutoSubmitFileInput(props: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="file" {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}
