/**
 * The brief's answers, saved as the client types them.
 *
 * Each question's answer is saved a moment after the typing stops (and at
 * once when the field is left), one save per question at a time: a save that
 * is still on its way is never overtaken by the next — the next waits and
 * then sends the latest text. So the first save creates the answer and every
 * later one changes that same answer, never a second one.
 */
import type { Outcome } from "../../../state/outcome.ts";

export type SaveAnswer = (question: string, answer: string) => Promise<Outcome<void>>;

export interface SaverState {
  /** Saves waiting or on their way. */
  pending: number;
  /** The last save's refusal, until a later save succeeds. */
  error: Outcome<void> | null;
  /** At least one answer has been saved on this visit. */
  saved: boolean;
}

export interface Saver {
  /** The client typed: save this text for this question shortly. */
  change(question: string, answer: string): void;
  /** Save anything waiting now (the field was left, the brief is being sent). */
  flush(): Promise<void>;
  state(): SaverState;
}

export function createSaver(save: SaveAnswer, onState: (s: SaverState) => void, wait = 700): Saver {
  const latest = new Map<string, string>();
  const timers = new Map<string, ReturnType<typeof setTimeout>>();
  const running = new Map<string, Promise<void>>();
  let state: SaverState = { pending: 0, error: null, saved: false };
  const set = (patch: Partial<SaverState>) => {
    state = { ...state, ...patch };
    onState(state);
  };
  const count = () => latest.size + running.size;

  const run = (question: string): Promise<void> => {
    const before = running.get(question);
    if (before !== undefined) return before.then(() => (latest.has(question) ? run(question) : undefined));
    const text = latest.get(question);
    if (text === undefined) return Promise.resolve();
    latest.delete(question);
    const going = save(question, text).then((out) => {
      running.delete(question);
      if (out.ok) set({ saved: true, error: null, pending: count() });
      else set({ error: out, pending: count() });
    });
    running.set(question, going);
    set({ pending: count() });
    return going.then(() => (latest.has(question) ? run(question) : undefined));
  };

  return {
    change(question, answer) {
      latest.set(question, answer);
      const timer = timers.get(question);
      if (timer !== undefined) clearTimeout(timer);
      timers.set(
        question,
        setTimeout(() => {
          timers.delete(question);
          void run(question);
        }, wait),
      );
      set({ pending: count() });
    },
    async flush() {
      for (const [question, timer] of timers) {
        clearTimeout(timer);
        timers.delete(question);
      }
      await Promise.all([...new Set([...latest.keys(), ...running.keys()])].map((q) => run(q)));
    },
    state: () => state,
  };
}
