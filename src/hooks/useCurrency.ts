import { useAuth } from "@/contexts/AuthContext";
import { formatMoney, getCurrencySymbol } from "@/lib/format";

export function useCurrency() {
  const { business } = useAuth();
  const currency = business?.currency ?? "NGN";
  return {
    currency,
    symbol: getCurrencySymbol(currency),
    fmt: (n: number | string | null | undefined) => formatMoney(n, currency),
  };
}
