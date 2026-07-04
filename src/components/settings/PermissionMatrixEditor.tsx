import { MODULE_ACTIONS, toggleAction, toggleModule, type PermissionMap } from "@/lib/permissions";
import { useAuth } from "@/contexts/AuthContext";
import { cn } from "@/lib/utils";

/** Shared module×action checkbox grid for role and member-override editors.
 *  Only modules the business's plan grants are offered. Checking any action implies `view`;
 *  unchecking `view` clears the module. */
export function PermissionMatrixEditor({ value, onChange, disabled = false }:
  { value: PermissionMap; onChange: (next: PermissionMap) => void; disabled?: boolean }) {
  const { hasModule } = useAuth();
  const modules = MODULE_ACTIONS.filter((m) => hasModule(m.key));

  return (
    <div className="space-y-2 max-h-[50vh] overflow-y-auto pr-1">
      {modules.map((m) => {
        const granted = new Set(value[m.key] ?? []);
        const moduleOn = granted.size > 0;
        return (
          <div key={m.key} className={cn("rounded-lg border p-3", moduleOn ? "border-brand/40 bg-brand-light/20" : "border-border/60")}>
            <label className="flex items-center gap-2 font-medium text-sm text-brand-dark">
              <input
                type="checkbox"
                checked={moduleOn}
                disabled={disabled}
                onChange={() => onChange(toggleModule(value, m.key))}
                aria-label={`${m.label} module`}
              />
              {m.label}
            </label>
            {moduleOn && (
              <div className="mt-2 grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1.5 pl-6">
                {m.actions.map((a) => (
                  <label key={a.key} className="flex items-center gap-2 text-sm text-muted-foreground">
                    <input
                      type="checkbox"
                      checked={granted.has(a.key)}
                      disabled={disabled}
                      onChange={() => onChange(toggleAction(value, m.key, a.key))}
                      aria-label={`${m.label}: ${a.label}`}
                    />
                    {a.label}
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
      {modules.length === 0 && <p className="text-sm text-muted-foreground">Your plan has no gateable modules.</p>}
    </div>
  );
}
