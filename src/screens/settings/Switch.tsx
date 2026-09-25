/**
 * The design's on/off switch: a real button with `role="switch"`, named by
 * the text beside it.
 */
export function Switch({ on, onToggle, labelledBy, disabled = false }: { on: boolean; onToggle: () => void; labelledBy: string; disabled?: boolean }) {
  return (
    <button type="button" role="switch" className="set-switch" aria-checked={on} aria-labelledby={labelledBy} disabled={disabled} onClick={onToggle}>
      <span className="set-switch-knob" aria-hidden="true" />
    </button>
  );
}
