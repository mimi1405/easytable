import { ArrowLeftIcon, BanknoteIcon, XIcon } from "lucide-react";
import { useState } from "react";
import { Button } from "@easytable/ui/components/button";
import { Card, CardContent } from "@easytable/ui/components/card";
import { cn } from "@easytable/ui/lib/utils";

import chipUrl from "../../assets/Chip.svg";
import { TouchNumberPad } from "../../components/TouchNumberPad";
import { formatChf } from "../../lib/money";
import type { MockPaymentMethod, MockPaymentRequest } from "../../lib/pos-types";

type PaymentScreenProps = {
  total: number;
  isSubmitting: boolean;
  onCancel: () => void;
  onSelectMethod: (payment: MockPaymentRequest) => void;
};

type PaymentView = "methods" | "cash";

const cashSuggestions = [
  { label: "5 CHF", valueInRappen: 500 },
  { label: "20 CHF", valueInRappen: 2000 },
  { label: "50 CHF", valueInRappen: 5000 },
  { label: "100 CHF", valueInRappen: 10000 },
];

export function PaymentScreen({
  total,
  isSubmitting,
  onCancel,
  onSelectMethod,
}: PaymentScreenProps) {
  const [paymentView, setPaymentView] = useState<PaymentView>("methods");
  const [receivedAmount, setReceivedAmount] = useState(0);
  const changeAmount = Math.max(receivedAmount - total, 0);
  const canCompleteCashPayment = receivedAmount >= total && !isSubmitting;

  function handleMethodSelect(method: MockPaymentMethod) {
    if (method === "CASH") {
      setReceivedAmount(0);
      setPaymentView("cash");
      return;
    }

    onSelectMethod({ payment_method: method });
  }

  if (paymentView === "cash") {
    return (
      <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f6f7fb] text-slate-950">
        <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-300 bg-white px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Button
              variant="ghost"
              size="icon"
              className="size-10 rounded-md text-slate-500"
              aria-label="Zurueck zur Zahlungsart"
              disabled={isSubmitting}
              onClick={() => setPaymentView("methods")}
            >
              <ArrowLeftIcon className="size-5" />
            </Button>
            <h1 className="truncate text-xl font-black text-slate-950">
              Barzahlung
            </h1>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="size-10 rounded-md text-slate-500"
            aria-label="Zahlung abbrechen"
            disabled={isSubmitting}
            onClick={onCancel}
          >
            <XIcon className="size-5" />
          </Button>
        </header>

        <section className="flex min-h-0 flex-1 items-center justify-center overflow-y-auto px-6 py-8">
          <div className="grid w-full max-w-5xl grid-cols-1 items-start gap-8 lg:grid-cols-[minmax(22rem,29rem)_minmax(20rem,27rem)]">
            <TouchNumberPad
              valueInRappen={receivedAmount}
              onChangeValueInRappen={setReceivedAmount}
              label="Erhaltener Betrag"
              disabled={isSubmitting}
            />

            <aside className="pt-1">
              <p className="mb-4 text-xs font-black uppercase tracking-[0.18em] text-slate-400">
                Vorschlaege
              </p>
              <div className="mb-8 grid grid-cols-3 gap-3">
                {cashSuggestions.map((suggestion) => (
                  <button
                    key={suggestion.label}
                    className="flex h-16 items-center justify-center rounded-md bg-white px-4 text-base font-black text-indigo-900 shadow-sm ring-1 ring-slate-200 transition active:scale-[0.985] active:bg-indigo-50 disabled:cursor-not-allowed disabled:opacity-50"
                    type="button"
                    disabled={isSubmitting}
                    onClick={() => setReceivedAmount(suggestion.valueInRappen)}
                  >
                    {suggestion.label}
                  </button>
                ))}
                <button
                  className="col-span-2 flex h-16 items-center justify-center rounded-md bg-indigo-50 px-4 text-base font-black text-indigo-900 shadow-sm ring-1 ring-indigo-100 transition active:scale-[0.985] active:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setReceivedAmount(total)}
                >
                  Passend
                </button>
              </div>

              <div className="border-t border-slate-400 pt-6">
                <div className="mb-5 flex items-center justify-between gap-4">
                  <p className="text-lg font-black text-slate-500">Total</p>
                  <p className="text-lg font-black text-slate-950">
                    {formatChf(total)}
                  </p>
                </div>
                <div className="mb-8 flex items-center justify-between gap-4">
                  <p className="text-2xl font-black text-slate-950">
                    Wechselgeld
                  </p>
                  <p
                    className={cn(
                      "text-3xl font-black",
                      changeAmount > 0 ? "text-slate-950" : "text-slate-300",
                    )}
                  >
                    {formatChf(changeAmount)}
                  </p>
                </div>

                <Button
                  className="h-16 w-full rounded-md bg-indigo-500 text-lg font-black text-white shadow-lg shadow-indigo-500/20 hover:bg-indigo-600 disabled:bg-indigo-300"
                  disabled={!canCompleteCashPayment}
                  onClick={() =>
                    onSelectMethod({
                      payment_method: "CASH",
                      received_cash: receivedAmount,
                      change_given: changeAmount,
                    })
                  }
                >
                  Abschliessen
                </Button>
              </div>
            </aside>
          </div>
        </section>
      </main>
    );
  }

  return (
    <main className="flex h-svh touch-manipulation flex-col overflow-hidden bg-[#f6f7fb] text-slate-950">
      <header className="flex h-16 shrink-0 items-center justify-between border-b border-slate-300 bg-white px-5">
        <div>
          <h1 className="text-xl font-black text-slate-950">
            Zahlungsart wählen
          </h1>
          <p className="text-xs font-black uppercase text-slate-400">
            {formatChf(total)}
          </p>
        </div>
        <Button
          variant="ghost"
          size="icon"
          className="size-10 rounded-md text-slate-500"
          aria-label="Zahlung abbrechen"
          disabled={isSubmitting}
          onClick={onCancel}
        >
          <XIcon className="size-5" />
        </Button>
      </header>

      <section className="flex min-h-0 flex-1 items-center justify-center px-6 py-8">
        <div className="grid w-full max-w-3xl grid-cols-1 gap-6 sm:grid-cols-2">
          <PaymentMethodCard
            method="CASH"
            title="CASH"
            eyebrow="Bezahlmethode"
            description="Schnelle Abwicklung"
            disabled={isSubmitting}
            onSelectMethod={handleMethodSelect}
          />
          <PaymentMethodCard
            method="CARD_MANUAL"
            title="KARTE"
            eyebrow="Kredit / Debit"
            description="Terminal Mock"
            dark
            disabled={isSubmitting}
            onSelectMethod={handleMethodSelect}
          />
        </div>
      </section>
    </main>
  );
}

type PaymentMethodCardProps = {
  method: MockPaymentMethod;
  title: string;
  eyebrow: string;
  description: string;
  dark?: boolean;
  disabled: boolean;
  onSelectMethod: (method: MockPaymentMethod) => void;
};

function PaymentMethodCard({
  method,
  title,
  eyebrow,
  description,
  dark = false,
  disabled,
  onSelectMethod,
}: PaymentMethodCardProps) {
  return (
    <button
      className="group text-left transition active:scale-[0.985] disabled:cursor-not-allowed disabled:opacity-60"
      disabled={disabled}
      onClick={() => onSelectMethod(method)}
    >
      <Card
        className={cn(
          "h-64 rounded-md py-0 shadow-xl shadow-slate-900/10 ring-1 transition group-hover:-translate-y-0.5",
          dark
            ? "border-slate-950 bg-gradient-to-br from-[#191a1f] to-[#111827] text-white ring-slate-950"
            : "border-slate-200 bg-white text-slate-950 ring-slate-200",
        )}
      >
        <CardContent className="flex h-full flex-col justify-between p-7">
          <div className="flex items-start justify-between gap-5">
            <div
              className={cn(
                "flex size-16 shrink-0 items-center justify-center rounded-md",
                dark ? "bg-transparent" : "bg-emerald-100",
              )}
            >
              {dark ? (
                <img src={chipUrl} alt="" className="h-12 w-14 object-contain" />
              ) : (
                <BanknoteIcon className="size-9 text-emerald-600" />
              )}
            </div>
            <div className="min-w-0 text-right">
              <p
                className={cn(
                  "text-xs font-black uppercase",
                  dark ? "text-slate-400" : "text-slate-400",
                )}
              >
                {eyebrow}
              </p>
              <p className="text-2xl font-black uppercase">{title}</p>
            </div>
          </div>

          <div>
            <div
              className={cn(
                "mb-3 h-1.5 w-16 rounded-full",
                dark ? "bg-blue-500" : "bg-emerald-200",
              )}
            />
            <p
              className={cn(
                "max-w-40 text-sm font-black",
                dark ? "text-slate-400" : "text-slate-500",
              )}
            >
              {description}
            </p>
          </div>
        </CardContent>
      </Card>
    </button>
  );
}
