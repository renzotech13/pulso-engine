"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Field, inputClass } from "@/components/ui/field";
import { Button, buttonClass } from "@/components/ui/button";

type Status = "idle" | "sending" | "error";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.signInWithPassword({ email, password });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    // Full navigation (not router.push) so the server sees the freshly-set session cookie.
    window.location.href = "/calendar";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Card padding="none" className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <p className="text-xs font-medium uppercase tracking-[0.2em] text-pulso-accent">Pulso Engine</p>
            <h1 className="font-display text-2xl tracking-wide text-neutral-100">Ingresa a tu cuenta</h1>
            <p className="text-sm text-neutral-400">Usa el correo y la contraseña de tu negocio.</p>
          </div>

          <div className="space-y-4">
            <Field id="login-email" label="Correo" required>
              <input
                id="login-email"
                type="email"
                name="email"
                autoComplete="email"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
                placeholder="tu@negocio.com"
                className={inputClass}
              />
            </Field>
            <Field id="login-password" label="Contraseña" required>
              <input
                id="login-password"
                type="password"
                name="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </Field>
          </div>

          {status === "error" && (
            <p role="alert" className="rounded-lg border border-status-pink/40 bg-status-pink/10 px-3 py-2 text-sm text-status-pink">
              {errorMessage}
            </p>
          )}

          <Button type="submit" pending={status === "sending"} pendingText="Ingresando…" className="w-full">
            Ingresar
          </Button>

          <div className="flex items-center justify-between text-xs text-neutral-500">
            <Link href="/forgot-password" className={buttonClass("link", "sm", "text-xs")}>
              ¿Olvidaste tu contraseña?
            </Link>
            <Link href="/signup" className={buttonClass("link", "sm", "text-xs")}>
              Crear cuenta
            </Link>
          </div>
        </form>
      </Card>
    </main>
  );
}
