import { Composition } from "remotion";
import { SmokeTest } from "./scenes/SmokeTest";
import { RoughLab } from "./scenes/RoughLab";
import { FigureCheck } from "./scenes/FigureCheck";
import { WalkCycle } from "./scenes/WalkCycle";
import { OutlineLab } from "./scenes/OutlineLab";
import { MeditationFigure, meditationFigureSchema } from "./scenes/MeditationFigure";

export const RemotionRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="SmokeTest"
        component={SmokeTest}
        durationInFrames={60}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="RoughLab"
        component={RoughLab}
        durationInFrames={90}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="FigureCheck"
        component={FigureCheck}
        durationInFrames={60}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="WalkCycle"
        component={WalkCycle}
        durationInFrames={72}
        fps={30}
        width={1280}
        height={720}
      />
      <Composition
        id="MeditationFigure"
        component={MeditationFigure}
        durationInFrames={300}
        fps={30}
        width={1280}
        height={720}
        schema={meditationFigureSchema}
        defaultProps={{
          ink: "#1b1b1b",
          paper: "#f4f1ea",
          figureScale: 3.3,
          headScale: 1.7,
          limbRounding: 4,
          torsoLength: 35,
          neckLength: 9.5,
          neckGap: 1,
          torsoBottomExtend: -0.5,
          strokeWidth: 2,
          roughness: 0.7,
          groundLine: 0.62,
          sinkUnits: 34,
          breathAmount: 1.6,
        }}
      />
      <Composition
        id="OutlineLab"
        component={OutlineLab}
        durationInFrames={60}
        fps={30}
        width={1280}
        height={720}
      />
    </>
  );
};
