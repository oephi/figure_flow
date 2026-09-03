import { SKELETON } from "../../src/lib/figure/skeleton";
import type { Pose } from "../../src/lib/figure/pose";
import type { BoneName } from "../../src/lib/figure/skeleton";

export interface JointReadoutProps {
  pose: Pose<BoneName>;
}

/**
 * Numeric readout of every joint's current angle, in skeleton (hierarchy)
 * order. A bone missing from `pose` is at rest (0 degrees) per the Pose
 * convention in src/lib/figure/pose.ts — shown dimmed so it's clear the
 * value is a default, not an authored one.
 */
export const JointReadout: React.FC<JointReadoutProps> = ({ pose }) => {
  return (
    <table className="joint-readout">
      <thead>
        <tr>
          <th>Bone</th>
          <th>Angle (deg)</th>
        </tr>
      </thead>
      <tbody>
        {SKELETON.map((bone) => {
          const authored = pose[bone.name] !== undefined;
          const angle = pose[bone.name] ?? 0;
          return (
            <tr key={bone.name} className={authored ? "authored" : "at-rest"}>
              <td>{bone.name}</td>
              <td>{angle.toFixed(1)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
};
