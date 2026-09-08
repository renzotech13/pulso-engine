"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Field, inputClass } from "@/components/ui/field";
import { Button, buttonClass } from "@/components/ui/button";

type Status = "idle" | "sending" | "sent" | "error";

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>("idle");
  const [errorMessage, setErrorMessage] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setStatus("sending");

    const supabase = createSupabaseBrowserClient();
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${window.location.origin}/auth/callback?next=/reset-password`,
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    setStatus("sent");
  }

  if (status === "sent") {
    return (
      <main className="flex min-h-screen items-center justify-center bg-ink p-4">
        <Card padding="none" className="w-full max-w-sm p-8 text-center">
          <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-accent/15 text-accent-ink">
            <MailCheck size={22} aria-hidden="true" />
          </div>
          <h1 className="font-display text-2xl tracking-tight text-fg">Revisa tu correo</h1>
          <p className="mt-3 text-sm text-fg-2">
            Si <span className="text-fg">{email}</span> tiene una cuenta, te enviamos un
            enlace para elegir una nueva contraseña.
          </p>
          <p className="mt-6 text-xs text-fg-3">
            <Link href="/login" className={buttonClass("link", "sm", "text-xs")}>
              Volver a ingresar
            </Link>
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink p-4">
      <Card padding="none" className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-5">
          <div className="space-y-1">
            <p className="eyebrow text-accent-ink">Amplifica Studio</p>
            <h1 className="font-display text-2xl tracking-tight text-fg">¿Olvidaste tu contraseña?</h1>
            <p className="text-sm text-fg-2">
              Escribe tu correo y te enviamos un enlace para elegir una nueva.
            </p>
          </div>

          <Field id="forgot-email" label="Correo" required>
            <input
              id="forgot-email"
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

          {status === "error" && (
            <p role="alert" className="rounded-btn border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
              {errorMessage}
            </p>
          )}

          <Button type="submit" pending={status === "sending"} pendingText="Enviando…" className="w-full">
            Enviar enlace
          </Button>

          <p className="text-center text-xs text-fg-3">
            <Link href="/login" className={buttonClass("link", "sm", "text-xs")}>
              Volver a ingresar
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
