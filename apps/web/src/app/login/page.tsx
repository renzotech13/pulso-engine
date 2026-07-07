"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";

type Status = "idle" | "sending" | "sent" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createSupabaseBrowserClient();
    // No emailRedirectTo: our custom magic_link.html template always points
    // to /auth/confirm with a fixed `next`, ignoring RedirectTo entirely.
    const { error } = await supabase.auth.signInWithOtp({ email });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }
    setStatus("sent");
  }

  return (
    <main className="flex min-h-screen items-center justify-center">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-sm space-y-4 rounded-lg border border-neutral-800 p-8"
      >
        <h1 className="text-xl font-semibold">Pulso Engine</h1>
        <p className="text-sm text-neutral-400">
          Ingresa con el enlace mágico que te enviaremos por correo.
        </p>
        <input
          type="email"
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="tu@negocio.com"
          className="w-full rounded border border-neutral-700 bg-neutral-900 px-3 py-2 text-sm"
        />
        <button
          type="submit"
          disabled={status === "sending"}
          className="w-full rounded bg-indigo-600 px-3 py-2 text-sm font-medium hover:bg-indigo-500 disabled:opacity-50"
        >
          {status === "sending" ? "Enviando..." : "Enviar enlace mágico"}
        </button>
        {status === "sent" && (
          <p className="text-sm text-emerald-400">
            Revisa tu correo para continuar (en local: http://127.0.0.1:54324 — Inbucket).
          </p>
        )}
        {status === "error" && <p className="text-sm text-red-400">{errorMessage}</p>}
      </form>
    </main>
  );
}
