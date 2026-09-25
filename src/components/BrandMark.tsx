/** The studio's mark: its image when it is one, else the first letter of its name. */
export function BrandMark({ mark, name }: { mark: string | null | undefined; name: string }) {
  const image = typeof mark === "string" && /^(https?:|data:image\/)/.test(mark);
  return (
    <span className="brand-mark" aria-hidden="true">
      {image ? <img src={mark} alt="" /> : (Array.from(name.trim())[0]?.toUpperCase() ?? "")}
    </span>
  );
}
