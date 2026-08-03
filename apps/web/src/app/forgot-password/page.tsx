"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
      <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
        <Card className="w-full max-w-sm p-8 text-center">
          <h1 className="font-display text-xl text-neutral-100">Revisa tu correo</h1>
          <p className="mt-3 text-sm text-neutral-400">
            Si <span className="text-neutral-200">{email}</span> tiene una cuenta, te enviamos un
            enlace para elegir una nueva contraseña.
          </p>
        </Card>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Card className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="font-display text-xl text-neutral-100">¿Olvidaste tu contraseña?</h1>
          <p className="text-sm text-neutral-400">
            Escribe tu correo y te enviamos un enlace para elegir una nueva.
          </p>
          <input
            type="email"
            required
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="tu@negocio.com"
            className={inputClass}
          />
          <Button type="submit" disabled={status === "sending"} className="w-full disabled:opacity-50">
            {status === "sending" ? "Enviando..." : "Enviar enlace"}
          </Button>
          {status === "error" && <p className="text-sm text-status-pink">{errorMessage}</p>}
          <p className="text-center text-xs text-neutral-500">
            <Link href="/login" className="hover:text-pulso-accent hover:underline">
              Volver a ingresar
            </Link>
          </p>
        </form>
      </Card>
    </main>
  );
}
