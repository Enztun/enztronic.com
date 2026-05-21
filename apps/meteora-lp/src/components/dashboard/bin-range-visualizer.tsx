'use client';

import { motion } from 'framer-motion';
import { PositionStatus } from '@/lib/meridian-types';
import { cn } from '@/lib/utils';

interface BinRangeVisualizerProps {
  binRangeMin: number;
  binRangeMax: number;
  activeBin: number;
  totalBins: number;
  status: PositionStatus;
  compact?: boolean;
}

function getStatusColors(status: PositionStatus) {
  switch (status) {
    case 'in-range':
      return {
        range: 'fill-emerald-500/30 stroke-emerald-500',
        rangeFill: 'rgba(16, 185, 129, 0.3)',
        rangeStroke: '#10b981',
        marker: '#10b981',
        markerGlow: 'rgba(16, 185, 129, 0.4)',
        badge: 'bg-emerald-500/20 text-emerald-400 border-emerald-500/30',
        gap: 'rgba(239, 68, 68, 0.15)',
        gapStroke: 'rgba(239, 68, 68, 0.5)',
        label: 'text-emerald-400',
      };
    case 'near-edge':
      return {
        range: 'fill-amber-500/30 stroke-amber-500',
        rangeFill: 'rgba(245, 158, 11, 0.3)',
        rangeStroke: '#f59e0b',
        marker: '#f59e0b',
        markerGlow: 'rgba(245, 158, 11, 0.4)',
        badge: 'bg-amber-500/20 text-amber-400 border-amber-500/30',
        gap: 'rgba(239, 68, 68, 0.15)',
        gapStroke: 'rgba(239, 68, 68, 0.5)',
        label: 'text-amber-400',
      };
    case 'out-of-range':
      return {
        range: 'fill-red-500/20 stroke-red-500',
        rangeFill: 'rgba(239, 68, 68, 0.2)',
        rangeStroke: '#ef4444',
        marker: '#ef4444',
        markerGlow: 'rgba(239, 68, 68, 0.4)',
        badge: 'bg-red-500/20 text-red-400 border-red-500/30',
        gap: 'rgba(239, 68, 68, 0.2)',
        gapStroke: '#ef4444',
        label: 'text-red-400',
      };
  }
}

export function BinRangeVisualizer({
  binRangeMin,
  binRangeMax,
  activeBin,
  totalBins,
  status,
  compact = false,
}: BinRangeVisualizerProps) {
  const colors = getStatusColors(status);
  const padding = 8;
  const svgWidth = 100;
  const svgHeight = compact ? 40 : 56;
  const barY = compact ? 14 : 22;
  const barHeight = compact ? 12 : 16;

  // Calculate positions as percentages of SVG width
  const usableWidth = svgWidth - padding * 2;
  const minPct = padding + (binRangeMin / totalBins) * usableWidth;
  const maxPct = padding + (binRangeMax / totalBins) * usableWidth;
  const activePct = padding + (activeBin / totalBins) * usableWidth;
  const rangeWidth = maxPct - minPct;

  // Determine if active bin is outside the range
  const isOOR = activeBin < binRangeMin || activeBin > binRangeMax;
  const isNearMinEdge = activeBin >= binRangeMin && activeBin - binRangeMin <= (binRangeMax - binRangeMin) * 0.15;
  const isNearMaxEdge = activeBin <= binRangeMax && binRangeMax - activeBin <= (binRangeMax - binRangeMin) * 0.15;

  // Distance from active bin to nearest range edge (as percentage of range)
  let distToEdgePct = 0;
  if (!isOOR) {
    const distToMin = (activeBin - binRangeMin) / (binRangeMax - binRangeMin) * 100;
    const distToMax = (binRangeMax - activeBin) / (binRangeMax - binRangeMin) * 100;
    distToEdgePct = Math.min(distToMin, distToMax);
  }

  // Gap rect for OOR positions
  let gapMin = 0;
  let gapMax = 0;
  if (isOOR) {
    if (activeBin < binRangeMin) {
      gapMin = activePct;
      gapMax = minPct;
    } else {
      gapMin = maxPct;
      gapMax = activePct;
    }
  }

  const statusLabel = status === 'in-range' ? 'In Range' : status === 'near-edge' ? 'Near Edge' : 'Out of Range';

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${svgWidth} ${svgHeight}`}
        className="w-full"
        preserveAspectRatio="xMidYMid meet"
      >
        {/* Background track */}
        <rect
          x={padding}
          y={barY}
          width={usableWidth}
          height={barHeight}
          rx={barHeight / 2}
          className="fill-muted/50"
        />

        {/* Bin tick marks */}
        {!compact && (
          <>
            {[0.25, 0.5, 0.75].map((pct) => (
              <line
                key={pct}
                x1={padding + pct * usableWidth}
                y1={barY + barHeight + 2}
                x2={padding + pct * usableWidth}
                y2={barY + barHeight + 5}
                className="stroke-muted-foreground/30"
                strokeWidth={0.3}
              />
            ))}
          </>
        )}

        {/* Gap region for OOR */}
        {isOOR && gapMax > gapMin && (
          <rect
            x={gapMin}
            y={barY}
            width={gapMax - gapMin}
            height={barHeight}
            rx={2}
            fill={colors.gap}
          />
        )}

        {/* Position range overlay */}
        <motion.rect
          x={minPct}
          y={barY}
          width={rangeWidth}
          height={barHeight}
          rx={barHeight / 2}
          fill={colors.rangeFill}
          stroke={colors.rangeStroke}
          strokeWidth={0.5}
          initial={{ opacity: 0, scaleX: 0 }}
          animate={{ opacity: 1, scaleX: 1 }}
          transition={{ duration: 0.6, ease: 'easeOut' }}
          style={{ transformOrigin: `${minPct}px ${barY + barHeight / 2}px` }}
        />

        {/* Range edge markers */}
        <line
          x1={minPct}
          y1={barY - 1}
          x2={minPct}
          y2={barY + barHeight + 1}
          stroke={colors.rangeStroke}
          strokeWidth={0.8}
          strokeDasharray="1.5 1"
        />
        <line
          x1={maxPct}
          y1={barY - 1}
          x2={maxPct}
          y2={barY + barHeight + 1}
          stroke={colors.rangeStroke}
          strokeWidth={0.8}
          strokeDasharray="1.5 1"
        />

        {/* Active bin marker (triangle) */}
        <motion.g
          initial={{ opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.3 }}
        >
          {/* Glow */}
          <circle
            cx={activePct}
            cy={barY + barHeight / 2}
            r={barHeight * 0.8}
            fill={colors.markerGlow}
            opacity={0.3}
          />
          {/* Triangle pointing down */}
          <polygon
            points={`${activePct},${barY - 3} ${activePct - 2.5},${barY - 7} ${activePct + 2.5},${barY - 7}`}
            fill={colors.marker}
          />
          {/* Active bin line */}
          <line
            x1={activePct}
            y1={barY}
            x2={activePct}
            y2={barY + barHeight}
            stroke={colors.marker}
            strokeWidth={1.2}
          />
          {/* Active bin dot */}
          <circle
            cx={activePct}
            cy={barY + barHeight / 2}
            r={2}
            fill={colors.marker}
          />
        </motion.g>

        {/* Labels */}
        {!compact && (
          <>
            {/* Min bin label */}
            <text
              x={minPct}
              y={barY + barHeight + 12}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={4}
              fontFamily="var(--font-geist-mono)"
            >
              {binRangeMin}
            </text>
            {/* Active bin label */}
            <text
              x={activePct}
              y={barY - 8}
              textAnchor="middle"
              fill={colors.marker}
              fontSize={4.5}
              fontWeight="bold"
              fontFamily="var(--font-geist-mono)"
            >
              {activeBin}
            </text>
            {/* Max bin label */}
            <text
              x={maxPct}
              y={barY + barHeight + 12}
              textAnchor="middle"
              className="fill-muted-foreground"
              fontSize={4}
              fontFamily="var(--font-geist-mono)"
            >
              {binRangeMax}
            </text>
          </>
        )}
      </svg>

      {/* Status info below */}
      <div className={cn('flex items-center justify-between mt-1', compact ? 'text-[10px]' : 'text-xs')}>
        <span className={cn('font-mono', colors.label)}>
          {statusLabel}
        </span>
        {!compact && !isOOR && (
          <span className="text-muted-foreground font-mono">
            Edge dist: {distToEdgePct.toFixed(0)}%
          </span>
        )}
        {!compact && isOOR && (
          <span className="text-red-400 font-mono">
            {activeBin < binRangeMin ? `${binRangeMin - activeBin} bins below` : `${activeBin - binRangeMax} bins above`}
          </span>
        )}
      </div>
    </div>
  );
}
