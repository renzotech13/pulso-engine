"use client";

import { useState, type FormEvent } from "react";
import { createSupabaseBrowserClient } from "@/lib/supabase/client";
import { Card } from "@/components/ui/card";
import { inputClass } from "@/components/ui/field";
import { Button } from "@/components/ui/button";

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

    window.location.href = "/agents";
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-ink-950 p-4">
      <Card className="w-full max-w-sm p-8">
        <form onSubmit={handleSubmit} className="space-y-4">
          <h1 className="font-display text-xl text-neutral-100">Elige una nueva contraseña</h1>
          <input
            type="password"
            required
            minLength={6}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            placeholder="Contraseña nueva (mínimo 6 caracteres)"
            className={inputClass}
          />
          <input
            type="password"
            required
            minLength={6}
            value={confirmPassword}
            onChange={(event) => setConfirmPassword(event.target.value)}
            placeholder="Confirmar contraseña nueva"
            className={inputClass}
          />
          <Button type="submit" disabled={status === "sending"} className="w-full disabled:opacity-50">
            {status === "sending" ? "Guardando..." : "Guardar contraseña"}
          </Button>
          {status === "error" && <p className="text-sm text-status-pink">{errorMessage}</p>}
        </form>
      </Card>
    </main>
  );
}
