/**
 * ForTool textový wordmark: „FOR" v navy (ink) + „TOOL" v azuru (signal).
 * Dle design handoffu — žádná bitmapa, čistý text (700, letter-spacing -0.02em).
 */
export default function Wordmark({ size = 20 }) {
  return (
    <span
      className="inline-flex items-baseline gap-0.5 font-bold tracking-[-0.02em] text-ink"
      style={{ fontSize: size, lineHeight: 1 }}
    >
      FOR<span className="text-signal">TOOL</span>
    </span>
  );
}
