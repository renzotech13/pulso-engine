"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { MailCheck } from "lucide-react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { Field, inputClass } from "@/components/ui/field";
import { Button, buttonClass } from "@/components/ui/button";

type Status = "idle" | "sending" | "sent" | "error";

export default function SignupPage() {
  const [email, setEmail] = useState("");
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
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: `${window.location.origin}/auth/callback?next=/onboarding` },
    });

    if (error) {
      setStatus("error");
      setErrorMessage(error.message);
      return;
    }

    // If email confirmation is off, signUp returns a live session directly — no need to wait for an email.
    if (data.session) {
      window.location.href = "/onboarding";
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
            Te enviamos un enlace de confirmación a <span className="text-fg">{email}</span>.
            Ábrelo para activar tu cuenta.
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
            <h1 className="font-display text-2xl tracking-tight text-fg">Crea tu cuenta</h1>
            <p className="text-sm text-fg-2">Necesitas una cuenta para configurar tu negocio.</p>
          </div>

          <div className="space-y-4">
            <Field id="signup-email" label="Correo" required>
              <input
                id="signup-email"
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
            <Field id="signup-password" label="Contraseña" hint="Mínimo 6 caracteres." required>
              <input
                id="signup-password"
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
            <Field id="signup-confirm" label="Confirmar contraseña" required>
              <input
                id="signup-confirm"
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

          <Button type="submit" pending={status === "sending"} pendingText="Creando cuenta…" className="w-full">
            Crear cuenta
          </Button>

          <p className="text-center text-xs text-fg-3">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className={buttonClass("link", "sm", "text-xs")}>
              Ingresa
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
