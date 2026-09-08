"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Field, inputClass } from "@/components/ui/field";
import { Button, buttonClass } from "@/components/ui/button";

type Status = "idle" | "sending" | "error";

export default function ResetPasswordPage() {
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();

    if (password !== confirmPassword) {
      setStatus("error");
      setErrorMessage("Las contraseñas no coinciden.");
      return;
    }

    setStatus("sending");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.updateUser({ password });

    if (error) {
      setStatus("error");
      setErrorMessage(
        error.message === "Auth session missing!"
          ? "El enlace ya expiró o no es válido. Pide uno nuevo desde \"¿Olvidaste tu contraseña?\"."
          : error.message,
      );
      return;
    }

    window.location.href = "/calendar";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <Card padding="none" className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <p className="eyebrow text-accent-ink">Amplifica Studio</p>
            <h1 className="font-display text-2xl tracking-tight text-fg">Elige una nueva contraseña</h1>
            <p className="text-sm text-fg-2">Al guardarla entrarás directo a tu calendario.</p>
          </div>

          <div className="space-y-4">
            <Field id="reset-password" label="Contraseña nueva" hint="Mínimo 6 caracteres." required>
              <input
                id="reset-password"
                type="password"
                name="password"
                autoComplete="new-password"
                required
                minLength={6}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </Field>
            <Field id="reset-confirm" label="Confirmar contraseña nueva" required>
              <input
                id="reset-confirm"
                type="password"
                name="confirmPassword"
                autoComplete="new-password"
                required
                minLength={6}
                value={confirmPassword}
                onChange={(event) => setConfirmPassword(event.target.value)}
                placeholder="••••••••"
                className={inputClass}
              />
            </Field>
          </div>

          {status === "error" && (
            <p role="alert" className="rounded-btn border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          )}

          <Button type="submit" pending={status === "sending"} pendingText="Guardando…" className="w-full">
            Guardar contraseña
          </Button>

          <p className="text-center text-xs text-fg-3">
            <Link href="/forgot-password" className={buttonClass("link", "sm", "text-xs")}>
              Pedir un enlace nuevo
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
