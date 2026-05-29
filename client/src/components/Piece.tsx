import { PIECE_DEFS, type PieceKind } from '@siguo/shared';

interface PieceProps {
  x: number;
  y: number;
  kind: PieceKind | null;
  ownerColor: string;
  frozen: boolean;
  revealed: boolean;
  /** Rotation (in degrees) to apply to the text glyph to keep it upright when
   *  the parent board is rotated for the viewer. */
  textCounterRotate?: number;
}

export function Piece({ x, y, kind, ownerColor, frozen, revealed, textCounterRotate = 0 }: PieceProps) {
  const size = 0.68;
  const opacity = frozen ? 0.5 : 1;
  return (
    <g
      transform={`translate(${x},${y})`}
      opacity={opacity}
      pointerEvents="none"
      style={{ transition: 'transform 280ms ease-in-out, opacity 200ms linear' }}
    >
      <rect
        x={-size / 2}
        y={-size / 2}
        width={size}
        height={size}
        rx={0.1}
        ry={0.1}
        fill={ownerColor}
        stroke="#0e1530"
        strokeWidth={0.04}
      />
      {revealed && kind ? (
        <text
          x={0}
          y={0.08}
          textAnchor="middle"
          fontSize={0.28}
          fill="#0e1530"
          fontWeight={700}
          transform={textCounterRotate ? `rotate(${textCounterRotate})` : undefined}
          style={{ fontFamily: 'system-ui, "PingFang SC", "Microsoft YaHei", sans-serif' }}
        >
          {PIECE_DEFS[kind].chinese}
        </text>
      ) : (
        // Face-down: just a back pattern.
        <g>
          <rect
            x={-size / 2 + 0.1}
            y={-size / 2 + 0.1}
            width={size - 0.2}
            height={size - 0.2}
            rx={0.05}
            ry={0.05}
            fill="none"
            stroke="#0e1530"
            strokeOpacity={0.45}
            strokeWidth={0.03}
          />
        </g>
      )}
    </g>
  );
}
