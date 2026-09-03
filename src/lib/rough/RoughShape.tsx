import type { PathInfo } from "roughjs/bin/core";

/**
 * rough.js also ships rough.svg() / rough.canvas(), which mutate the DOM directly.
 * That fights React. Instead we use rough.generator(), whose output is pure data
 * (an array of PathInfo), and render it as plain <path> elements. Pure data means
 * it memoises and unit-tests.
 */
export const RoughPaths: React.FC<{ paths: PathInfo[] }> = ({ paths }) => {
  return (
    <>
      {paths.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke={p.stroke === "none" ? undefined : p.stroke}
          strokeWidth={p.strokeWidth}
          fill={p.fill ?? "none"}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      ))}
    </>
  );
};
