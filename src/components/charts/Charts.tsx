import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, CartesianGrid, BarChart, Bar, Cell, PieChart, Pie } from "recharts";

// The only module that imports recharts. Pages reach it through LazyCharts so the chart bundle
// loads after the page's own data and KPIs are on screen, not before.

const TOOLTIP_STYLE = { background: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 12, fontSize: 12 };
const AXIS = "hsl(var(--muted-foreground))";
const BRAND = "hsl(var(--brand))";

type Money = (v: number) => string;

export function TrendAreaChart({ data, fmt, gradientId, detailed = false }: {
  data: { day: string; total: number }[]; fmt: Money; gradientId: string;
  /** Reports variant: grid lines + a Y axis. The Dashboard keeps the sparse sparkline look. */
  detailed?: boolean;
}) {
  const fontSize = detailed ? 11 : 12;
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data}>
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={BRAND} stopOpacity={0.4} />
            <stop offset="100%" stopColor={BRAND} stopOpacity={0} />
          </linearGradient>
        </defs>
        {detailed && <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />}
        <XAxis dataKey="day" stroke={AXIS} fontSize={fontSize} tickLine={false} axisLine={false} />
        {detailed && <YAxis stroke={AXIS} fontSize={fontSize} tickLine={false} axisLine={false} />}
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmt(v)} />
        <Area type="monotone" dataKey="total" stroke={BRAND} strokeWidth={2.5} fill={`url(#${gradientId})`} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function StockLevelsChart({ data }: { data: { name: string; stock: number; low: boolean }[] }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
        <XAxis dataKey="name" stroke={AXIS} fontSize={10} tickLine={false} axisLine={false} />
        <YAxis stroke={AXIS} fontSize={10} tickLine={false} axisLine={false} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => [`${v} units`, "Stock"]} />
        <Bar dataKey="stock" radius={[4, 4, 0, 0]}>
          {data.map((entry, index) => (
            <Cell key={index} fill={entry.low ? "hsl(var(--warning))" : BRAND} fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function RevenueBarChart({ data, fmt, labelWidth }: { data: { name: string; revenue: number }[]; fmt: Money; labelWidth: number }) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} layout="vertical" margin={{ left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis type="number" stroke={AXIS} fontSize={11} tickFormatter={(v) => fmt(v)} />
        <YAxis type="category" dataKey="name" width={labelWidth} stroke={AXIS} fontSize={11} />
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number) => fmt(v)} />
        <Bar dataKey="revenue" fill={BRAND} radius={[0, 6, 6, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function PaymentDonut({ data, colors, fmt, label, radius }: {
  data: { method: string; total: number }[]; colors: string[]; fmt: Money; label: (method: string) => string;
  radius: [inner: number, outer: number];
}) {
  return (
    <ResponsiveContainer width="100%" height="100%">
      <PieChart>
        <Pie data={data} dataKey="total" nameKey="method" innerRadius={radius[0]} outerRadius={radius[1]} paddingAngle={2}>
          {data.map((_, i) => <Cell key={i} fill={colors[i % colors.length]} />)}
        </Pie>
        <Tooltip contentStyle={TOOLTIP_STYLE} formatter={(v: number, n) => [fmt(v), label(String(n))]} />
      </PieChart>
    </ResponsiveContainer>
  );
}
