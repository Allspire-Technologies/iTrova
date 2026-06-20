import { Star } from "lucide-react";

type Props = {
  value: number | null | undefined;
  onChange?: (v: number) => void;
  size?: number;
  readOnly?: boolean;
};

export default function StarRating({ value, onChange, size = 16, readOnly }: Props) {
  const v = Number(value || 0);
  return (
    <div className="inline-flex items-center gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => {
        const filled = n <= v;
        const Btn = (
          <Star
            className={`shrink-0 ${filled ? "fill-warning text-warning" : "text-muted-foreground/40"}`}
            style={{ width: size, height: size }}
          />
        );
        if (readOnly || !onChange) return <span key={n}>{Btn}</span>;
        return (
          <button key={n} type="button" onClick={() => onChange(n === v ? 0 : n)} className="p-0.5 hover:scale-110 transition-transform" aria-label={`${n} star${n === 1 ? "" : "s"}`}>
            {Btn}
          </button>
        );
      })}
    </div>
  );
}
