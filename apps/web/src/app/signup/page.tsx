"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
      <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
        <Card className="w-full max-w-sm p-8 text-center">
          <h1 className="font-display text-xl text-neutral-100">Revisa tu correo</h1>
          <p className="mt-3 text-sm text-neutral-400">
            Te enviamos un enlace de confirmación a <span className="text-neutral-200">{email}</span>.
            Ábrelo para activar tu cuenta.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Card className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="font-display text-xl text-neutral-100">Crea tu cuenta</h1>
          <p className="text-sm text-neutral-400">Necesitas una cuenta para configurar tu negocio.</p>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@negocio.com"
            className={inputClass}
          />
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Contraseña (mínimo 6 caracteres)"
            className={inputClass}
          />
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirmar contraseña"
            className={inputClass}
          />
          <Button type="submit" disabled={status === "sending"} className="w-full disabled:opacity-50">
            {status === "sending" ? "Creando cuenta..." : "Crear cuenta"}
          </Button>
          {status === "error" && <p className="text-sm text-status-pink">{errorMessage}</p>}
          <p className="text-center text-xs text-neutral-500">
            ¿Ya tienes cuenta?{" "}
            <Link href="/login" className="hover:text-pulso-accent hover:underline">
              Ingresa
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
