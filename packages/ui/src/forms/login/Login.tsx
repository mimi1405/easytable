import type * as React from "react"
import { useState } from "react"

import { cn } from "@easytable/ui/lib/utils"
import { useTranslation } from "@easytable/ui/i18n"
import { signIn } from "@easytable/auth"
import { Button } from "../../components/button"
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "../../components/field"
import { Input } from "../../components/input"

export interface LoginFormProps extends Omit<React.ComponentProps<"form">, "onSubmit"> {
  onSuccess?: () => void
}

export function LoginForm({
  className,
  onSuccess,
  ...props
}: LoginFormProps) {
  const { t } = useTranslation("ui")
  const [email, setEmail] = useState("")
  const [password, setPassword] = useState("")
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)
    setError(null)
    try {
      const res = await signIn.email({
        email,
        password,
      })
      if (res?.error) {
        setError(res.error.message || "Login failed")
      } else {
        onSuccess?.()
      }
    } catch (err: any) {
      setError(err.message || "An unexpected error occurred")
    } finally {
      setLoading(false)
    }
  }

  return (
    <form className={cn("flex flex-col gap-6", className)} onSubmit={handleSubmit} {...props}>
      <FieldGroup>
        <div className="flex flex-col items-center gap-1 text-center">
          <h1 className="text-2xl font-bold">{t("login.form.title")}</h1>
          <p className="text-sm text-balance text-muted-foreground">
            {t("login.form.description")}
          </p>
        </div>
        {error && (
          <div className="text-sm font-semibold text-red-600 text-center">
            {error}
          </div>
        )}
        <Field>
          <FieldLabel htmlFor="email">{t("login.form.emailLabel")}</FieldLabel>
          <Input
            id="email"
            type="email"
            placeholder={t("login.form.emailPlaceholder")}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            required
          />
        </Field>
        <Field>
          <div className="flex items-center">
            <FieldLabel htmlFor="password">
              {t("login.form.passwordLabel")}
            </FieldLabel>
            <span
              className="ml-auto text-sm text-muted-foreground"
              title="Bitte wende dich an einen Administrator, um dein Passwort zuruecksetzen zu lassen."
            >
              {t("login.form.forgotPassword")}
            </span>
          </div>
          <Input 
            id="password" 
            type="password" 
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required 
          />
        </Field>
        <Field>
          <Button type="submit" disabled={loading}>
            {loading ? t("login.form.loading") || "Lade..." : t("login.form.submit")}
          </Button>
        </Field>
        <Field>
          <FieldDescription className="text-center">
            {t("login.form.signUpPrompt")}{" "}
            <a href="#" className="underline underline-offset-4">
              {t("login.form.signUp")}
            </a>
          </FieldDescription>
        </Field>
      </FieldGroup>
    </form>
  )
}
