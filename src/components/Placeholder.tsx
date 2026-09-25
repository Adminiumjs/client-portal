/**
 * A screen or a sheet still to be drawn: it names itself, and nothing more.
 * Each placeholder file is replaced whole by the screen it stands for.
 */
import { useI18n, type MessageKey } from "../i18n/index.tsx";

export function Placeholder({ titleKey, view }: { titleKey: MessageKey; view: string }) {
  const { t } = useI18n();
  return (
    <section className="screen placeholder ol-screen" data-screen={view} aria-labelledby={`screen-${view}`}>
      <h1 className="screen-title" id={`screen-${view}`}>
        {t(titleKey)}
      </h1>
    </section>
  );
}
