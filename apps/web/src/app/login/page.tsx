"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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
    window.location.href = "/agents";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Card className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="font-display text-xl text-neutral-100">Pulso Engine</h1>
          <p className="text-sm text-neutral-400">Ingresa con tu correo y contraseña.</p>
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Contraseña"
            className={inputClass}
          />
          <Button type="submit" disabled={status === "sending"} className="w-full disabled:opacity-50">
            {status === "sending" ? "Ingresando..." : "Ingresar"}
          </Button>
          {status === "error" && <p className="text-sm text-status-pink">{errorMessage}</p>}
          <div className="flex items-center justify-between text-xs text-neutral-500">
            <Link href="/forgot-password" className="hover:text-pulso-accent hover:underline">
              ¿Olvidaste tu contraseña?
            </Link>
            <Link href="/signup" className="hover:text-pulso-accent hover:underline">
              Crear cuenta
            </Link>
          </div>
        </form>
      </Card>
    </main>
  );
}
