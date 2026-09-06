import { Suspense, type ComponentProps } from "react";
import { lazyWithRetry } from "@/lib/lazyWithRetry";
import type * as Charts from "./Charts";

// Lazy front for ./Charts: pages render these and the recharts chunk is fetched on first use.
// Each wrapper fills its parent (the page owns the sized, role="img" container), so the pulse
// placeholder holds the exact space the chart will take and nothing shifts when it lands.

const load = () => import("./Charts");
const Trend = lazyWithRetry(() => load().then((m) => ({ default: m.TrendAreaChart })));
const Stock = lazyWithRetry(() => load().then((m) => ({ default: m.StockLevelsChart })));
const Revenue = lazyWithRetry(() => load().then((m) => ({ default: m.RevenueBarChart })));
const Donut = lazyWithRetry(() => load().then((m) => ({ default: m.PaymentDonut })));

function ChartFallback() {
  return <div className="h-full w-full animate-pulse rounded-lg bg-muted/40" aria-hidden="true" />;
}

export function TrendAreaChart(props: ComponentProps<typeof Charts.TrendAreaChart>) {
  return <Suspense fallback={<ChartFallback />}><Trend {...props} /></Suspense>;
}
export function StockLevelsChart(props: ComponentProps<typeof Charts.StockLevelsChart>) {
  return <Suspense fallback={<ChartFallback />}><Stock {...props} /></Suspense>;
}
export function RevenueBarChart(props: ComponentProps<typeof Charts.RevenueBarChart>) {
  return <Suspense fallback={<ChartFallback />}><Revenue {...props} /></Suspense>;
}
export function PaymentDonut(props: ComponentProps<typeof Charts.PaymentDonut>) {
  return <Suspense fallback={<ChartFallback />}><Donut {...props} /></Suspense>;
}
