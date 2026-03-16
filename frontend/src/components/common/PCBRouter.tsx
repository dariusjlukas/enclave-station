import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faArrowsRotate,
  faClock,
  faLightbulb,
  faTrophy,
} from '@fortawesome/free-solid-svg-icons';

// ── Types ───────────────────────────────────────────────────────────────────

type Layer = 'front' | 'back';
type Difficulty = 'easy' | 'medium' | 'hard';
type GameState = 'idle' | 'playing' | 'won';

interface Coord {
  row: number;
  col: number;
}

interface Pad {
  netId: number;
  coord: Coord;
}

interface RouteStep {
  coord: Coord;
  layer: Layer;
}

interface Via {
  coord: Coord;
  netId: number;
}

interface Route {
  netId: number;
  steps: RouteStep[];
  vias: Via[];
  complete: boolean;
}

interface PuzzleConfig {
  rows: number;
  cols: number;
  pads: Pad[];
}

interface RoutingState {
  netId: number;
  steps: RouteStep[];
  currentLayer: Layer;
}

// ── Constants ───────────────────────────────────────────────────────────────

const NET_COLORS = [
  {
    trace: 'bg-red-500',
    traceback: 'bg-red-400/50',
    pad: 'bg-red-500',
    ring: 'ring-red-500/40',
    text: 'text-red-500',
  },
  {
    trace: 'bg-blue-500',
    traceback: 'bg-blue-400/50',
    pad: 'bg-blue-500',
    ring: 'ring-blue-500/40',
    text: 'text-blue-500',
  },
  {
    trace: 'bg-green-500',
    traceback: 'bg-green-400/50',
    pad: 'bg-green-500',
    ring: 'ring-green-500/40',
    text: 'text-green-500',
  },
  {
    trace: 'bg-amber-500',
    traceback: 'bg-amber-400/50',
    pad: 'bg-amber-500',
    ring: 'ring-amber-500/40',
    text: 'text-amber-500',
  },
  {
    trace: 'bg-purple-500',
    traceback: 'bg-purple-400/50',
    pad: 'bg-purple-500',
    ring: 'ring-purple-500/40',
    text: 'text-purple-500',
  },
  {
    trace: 'bg-cyan-500',
    traceback: 'bg-cyan-400/50',
    pad: 'bg-cyan-500',
    ring: 'ring-cyan-500/40',
    text: 'text-cyan-500',
  },
];

// ── Puzzle Generation ───────────────────────────────────────────────────────

const DIFFICULTY_CONFIGS: Record<
  Difficulty,
  { rows: number; cols: number; nets: number; minPairDist: number }
> = {
  easy: { rows: 6, cols: 6, nets: 3, minPairDist: 4 },
  medium: { rows: 7, cols: 7, nets: 4, minPairDist: 4 },
  hard: { rows: 8, cols: 8, nets: 5, minPairDist: 5 },
};

function manhattan(a: Coord, b: Coord): number {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

/** BFS on 2-layer grid to route one net, avoiding occupied cells. */
function bfsRoute(
  start: Coord,
  end: Coord,
  rows: number,
  cols: number,
  occupied: Set<string>,
): RouteStep[] | null {
  const parent = new Map<string, string | null>();
  const stateOf = new Map<string, RouteStep>();
  const queue: string[] = [];

  // Start on both layers
  for (const layer of ['front', 'back'] as Layer[]) {
    const key = `${start.row},${start.col},${layer}`;
    if (!occupied.has(key)) {
      parent.set(key, null);
      stateOf.set(key, { coord: start, layer });
      queue.push(key);
    }
  }

  let head = 0;
  while (head < queue.length) {
    const key = queue[head++];
    const step = stateOf.get(key)!;

    if (step.coord.row === end.row && step.coord.col === end.col) {
      const path: RouteStep[] = [];
      let cur: string | null = key;
      while (cur !== null) {
        path.push(stateOf.get(cur)!);
        cur = parent.get(cur)!;
      }
      return path.reverse();
    }

    // 4 orthogonal moves on same layer
    const moves: [number, number][] = [
      [-1, 0],
      [1, 0],
      [0, -1],
      [0, 1],
    ];
    for (const [dr, dc] of moves) {
      const nr = step.coord.row + dr;
      const nc = step.coord.col + dc;
      if (nr < 0 || nr >= rows || nc < 0 || nc >= cols) continue;
      const nkey = `${nr},${nc},${step.layer}`;
      if (parent.has(nkey) || occupied.has(nkey)) continue;
      parent.set(nkey, key);
      stateOf.set(nkey, { coord: { row: nr, col: nc }, layer: step.layer });
      queue.push(nkey);
    }

    // Via — switch layer at same cell
    const otherLayer: Layer = step.layer === 'front' ? 'back' : 'front';
    const viaKey = `${step.coord.row},${step.coord.col},${otherLayer}`;
    if (!parent.has(viaKey) && !occupied.has(viaKey)) {
      parent.set(viaKey, key);
      stateOf.set(viaKey, { coord: step.coord, layer: otherLayer });
      queue.push(viaKey);
    }
  }

  return null;
}

/** Generate all permutations of indices 0..n-1. */
function permutations(n: number): number[][] {
  if (n === 0) return [[]];
  const result: number[][] = [];
  const perm = (arr: number[], chosen: number[]) => {
    if (arr.length === 0) {
      result.push(chosen);
      return;
    }
    for (let i = 0; i < arr.length; i++) {
      perm([...arr.slice(0, i), ...arr.slice(i + 1)], [...chosen, arr[i]]);
    }
  };
  perm(
    Array.from({ length: n }, (_, i) => i),
    [],
  );
  return result;
}

/** Try to solve a puzzle, returning the routes if successful. */
function solvePuzzle(pads: Pad[], rows: number, cols: number): Route[] | null {
  const netCount = new Set(pads.map((p) => p.netId)).size;
  const netPairs: [Coord, Coord][] = [];
  for (let i = 0; i < netCount; i++) {
    const pair = pads.filter((p) => p.netId === i);
    netPairs.push([pair[0].coord, pair[1].coord]);
  }

  for (const perm of permutations(netCount)) {
    const occupied = new Set<string>();
    const routes: Route[] = [];
    let success = true;

    for (const netIdx of perm) {
      // Block other nets' pads on both layers (through-hole)
      const occForThis = new Set(occupied);
      for (const pad of pads) {
        if (pad.netId !== netIdx) {
          occForThis.add(`${pad.coord.row},${pad.coord.col},front`);
          occForThis.add(`${pad.coord.row},${pad.coord.col},back`);
        }
      }

      const [start, end] = netPairs[netIdx];
      const steps = bfsRoute(start, end, rows, cols, occForThis);
      if (!steps) {
        success = false;
        break;
      }

      const vias: Via[] = [];
      for (let i = 1; i < steps.length; i++) {
        if (steps[i].layer !== steps[i - 1].layer) {
          vias.push({ coord: steps[i - 1].coord, netId: netIdx });
        }
      }
      routes.push({ netId: netIdx, steps, vias, complete: true });

      for (const step of steps) {
        occupied.add(`${step.coord.row},${step.coord.col},${step.layer}`);
      }
    }

    if (success) return routes;
  }

  return null;
}

function isSolvable(pads: Pad[], rows: number, cols: number): boolean {
  return solvePuzzle(pads, rows, cols) !== null;
}

/** Generate a random puzzle guaranteed to be solvable. */
function generatePuzzle(difficulty: Difficulty): PuzzleConfig {
  const { rows, cols, nets, minPairDist } = DIFFICULTY_CONFIGS[difficulty];

  for (let attempt = 0; attempt < 500; attempt++) {
    const usedCells = new Set<string>();
    const pads: Pad[] = [];
    let valid = true;

    for (let netId = 0; netId < nets; netId++) {
      let placed = false;
      for (let tries = 0; tries < 50; tries++) {
        const a: Coord = {
          row: Math.floor(Math.random() * rows),
          col: Math.floor(Math.random() * cols),
        };
        const b: Coord = {
          row: Math.floor(Math.random() * rows),
          col: Math.floor(Math.random() * cols),
        };

        if (coordEq(a, b)) continue;
        if (manhattan(a, b) < minPairDist) continue;
        const aKey = `${a.row},${a.col}`;
        const bKey = `${b.row},${b.col}`;
        if (usedCells.has(aKey) || usedCells.has(bKey)) continue;

        usedCells.add(aKey);
        usedCells.add(bKey);
        pads.push({ netId, coord: a }, { netId, coord: b });
        placed = true;
        break;
      }
      if (!placed) {
        valid = false;
        break;
      }
    }

    if (!valid) continue;
    if (isSolvable(pads, rows, cols)) {
      return { rows, cols, pads };
    }
  }

  // Fallback: trivial puzzle (horizontal pairs on separate rows)
  const pads: Pad[] = [];
  for (let i = 0; i < nets; i++) {
    pads.push({ netId: i, coord: { row: i * 2, col: 0 } });
    pads.push({ netId: i, coord: { row: i * 2, col: cols - 1 } });
  }
  return { rows, cols, pads };
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function coordEq(a: Coord, b: Coord): boolean {
  return a.row === b.row && a.col === b.col;
}

function isAdjacent(a: Coord, b: Coord): boolean {
  return (
    (Math.abs(a.row - b.row) === 1 && a.col === b.col) ||
    (Math.abs(a.col - b.col) === 1 && a.row === b.row)
  );
}

type OccupancyKey = `${number},${number},${Layer}`;

function buildOccupancy(
  routes: Route[],
  activeRouting?: RoutingState | null,
): Map<OccupancyKey, number> {
  const map = new Map<OccupancyKey, number>();
  for (const route of routes) {
    for (const step of route.steps) {
      const key: OccupancyKey = `${step.coord.row},${step.coord.col},${step.layer}`;
      map.set(key, route.netId);
    }
  }
  if (activeRouting) {
    for (const step of activeRouting.steps) {
      const key: OccupancyKey = `${step.coord.row},${step.coord.col},${step.layer}`;
      map.set(key, activeRouting.netId);
    }
  }
  return map;
}

function getNetCount(pads: Pad[]): number {
  const ids = new Set(pads.map((p) => p.netId));
  return ids.size;
}

function getPadAt(pads: Pad[], coord: Coord): Pad | undefined {
  return pads.find((pad) => coordEq(pad.coord, coord));
}

function getMatchingPad(
  pads: Pad[],
  netId: number,
  startCoord: Coord,
): Pad | undefined {
  return pads.find(
    (pad) => pad.netId === netId && !coordEq(pad.coord, startCoord),
  );
}

/** Get the direction from cell `from` to adjacent cell `to` */
function getDirection(
  from: Coord,
  to: Coord,
): 'top' | 'bottom' | 'left' | 'right' | null {
  if (to.row === from.row - 1 && to.col === from.col) return 'top';
  if (to.row === from.row + 1 && to.col === from.col) return 'bottom';
  if (to.col === from.col - 1 && to.row === from.row) return 'left';
  if (to.col === from.col + 1 && to.row === from.row) return 'right';
  return null;
}

// ── Trace direction computation ─────────────────────────────────────────────

interface CellTrace {
  netId: number;
  layer: Layer;
  directions: Set<'top' | 'bottom' | 'left' | 'right'>;
  isVia: boolean;
}

function computeCellTraces(
  routes: Route[],
  activeRouting: RoutingState | null,
): Map<string, CellTrace[]> {
  const cellMap = new Map<string, CellTrace[]>();

  const addSteps = (steps: RouteStep[], netId: number) => {
    for (let i = 0; i < steps.length; i++) {
      const step = steps[i];
      const key = `${step.coord.row},${step.coord.col}`;
      const dirs = new Set<'top' | 'bottom' | 'left' | 'right'>();

      // Check previous step
      if (i > 0 && steps[i - 1].layer === step.layer) {
        const dir = getDirection(step.coord, steps[i - 1].coord);
        if (dir) dirs.add(dir);
      }
      // Check next step
      if (i < steps.length - 1 && steps[i + 1].layer === step.layer) {
        const dir = getDirection(step.coord, steps[i + 1].coord);
        if (dir) dirs.add(dir);
      }

      // Detect via: layer changes at this step
      const isVia =
        (i > 0 && steps[i - 1].layer !== step.layer) ||
        (i < steps.length - 1 && steps[i + 1].layer !== step.layer);

      const existing = cellMap.get(key) ?? [];
      // Merge with existing trace on same layer and net
      const match = existing.find(
        (t) => t.netId === netId && t.layer === step.layer,
      );
      if (match) {
        dirs.forEach((d) => match.directions.add(d));
        if (isVia) match.isVia = true;
      } else {
        existing.push({ netId, layer: step.layer, directions: dirs, isVia });
      }
      cellMap.set(key, existing);
    }
  };

  for (const route of routes) {
    addSteps(route.steps, route.netId);
  }
  if (activeRouting) {
    addSteps(activeRouting.steps, activeRouting.netId);
  }

  return cellMap;
}

// ── Component ───────────────────────────────────────────────────────────────

export function PCBRouter({ large }: { large?: boolean } = {}) {
  const [difficulty, setDifficulty] = useState<Difficulty>('easy');
  const [puzzle, setPuzzle] = useState<PuzzleConfig>(() =>
    generatePuzzle('easy'),
  );
  const [routes, setRoutes] = useState<Route[]>([]);
  const [routing, setRouting] = useState<RoutingState | null>(null);
  const [viewLayer, setViewLayer] = useState<Layer>('front');
  const [gameState, setGameState] = useState<GameState>('idle');
  const [timer, setTimer] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  // Ref mirrors routing state so mouseenter handlers always see latest value
  const routingRef = useRef<RoutingState | null>(null);
  useEffect(() => {
    routingRef.current = routing;
  });

  const netCount = getNetCount(puzzle.pads);

  const cellTraces = useMemo(
    () => computeCellTraces(routes, routing),
    [routes, routing],
  );

  const completedNets = routes.filter((r) => r.complete).length;

  // Timer
  useEffect(() => {
    if (gameState === 'playing') {
      timerRef.current = setInterval(() => setTimer((t) => t + 1), 1000);
      return () => {
        if (timerRef.current) clearInterval(timerRef.current);
      };
    }
    if (timerRef.current) clearInterval(timerRef.current);
  }, [gameState]);

  const formatTime = (s: number) => {
    const mins = Math.floor(s / 60);
    const secs = s % 60;
    return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  // ── Game actions ────────────────────────────────────────────────────────

  const resetGame = useCallback(() => {
    setRoutes([]);
    setRouting(null);
    setViewLayer('front');
    setGameState('idle');
    setTimer(0);
  }, []);

  const newPuzzle = useCallback(
    (d?: Difficulty) => {
      const diff = d ?? difficulty;
      if (d) setDifficulty(diff);
      setPuzzle(generatePuzzle(diff));
      setRoutes([]);
      setRouting(null);
      setViewLayer('front');
      setGameState('idle');
      setTimer(0);
    },
    [difficulty],
  );

  const showSolution = useCallback(() => {
    const solution = solvePuzzle(puzzle.pads, puzzle.rows, puzzle.cols);
    if (solution) {
      setRoutes(solution);
      setRouting(null);
      setGameState('won');
    }
  }, [puzzle]);

  const toggleLayer = useCallback(() => {
    const newLayer: Layer = viewLayer === 'front' ? 'back' : 'front';
    setViewLayer(newLayer);
    if (routing) {
      setRouting({ ...routing, currentLayer: newLayer });
    }
  }, [viewLayer, routing]);

  // ── Commit a completed route ────────────────────────────────────────────

  const commitRoute = useCallback(
    (routingState: RoutingState) => {
      const finalSteps = routingState.steps;

      // Compute vias
      const vias: Via[] = [];
      for (let i = 1; i < finalSteps.length; i++) {
        if (finalSteps[i].layer !== finalSteps[i - 1].layer) {
          vias.push({
            coord: finalSteps[i - 1].coord,
            netId: routingState.netId,
          });
        }
      }

      const newRoute: Route = {
        netId: routingState.netId,
        steps: finalSteps,
        vias,
        complete: true,
      };

      const newRoutes = [
        ...routes.filter((r) => r.netId !== routingState.netId),
        newRoute,
      ];
      setRoutes(newRoutes);
      setRouting(null);

      // Check win
      const done = newRoutes.filter((r) => r.complete).length;
      if (done === netCount) {
        setGameState('won');
      }
    },
    [routes, netCount],
  );

  // ── Cell click: start routing, or stop/complete ───────────────────────

  const handleCellClick = useCallback(
    (row: number, col: number) => {
      if (gameState === 'won') return;

      const coord: Coord = { row, col };

      if (gameState === 'idle') {
        setGameState('playing');
      }

      // ── Not currently routing → start on pad click ──
      if (!routing) {
        const pad = getPadAt(puzzle.pads, coord);
        if (!pad) return;

        const existingRoute = routes.find(
          (r) => r.netId === pad.netId && r.complete,
        );
        if (existingRoute) return;

        setRouting({
          netId: pad.netId,
          steps: [{ coord, layer: viewLayer }],
          currentLayer: viewLayer,
        });
        return;
      }

      // ── Currently routing → click to stop ──
      // Check if we're on the matching pad to complete
      const matchingPad = getMatchingPad(
        puzzle.pads,
        routing.netId,
        routing.steps[0].coord,
      );
      if (
        matchingPad &&
        coordEq(
          routing.steps[routing.steps.length - 1].coord,
          matchingPad.coord,
        )
      ) {
        commitRoute(routing);
      } else {
        // Cancel — not on the target pad
        setRouting(null);
      }
    },
    [routing, routes, puzzle, viewLayer, gameState, commitRoute],
  );

  // ── Mouse enter: auto-extend or backtrack the trace ───────────────────

  const handleCellEnter = useCallback(
    (row: number, col: number) => {
      const r = routingRef.current;
      if (!r) return;

      const coord: Coord = { row, col };
      const lastStep = r.steps[r.steps.length - 1];

      // If hovering over a cell already in the path → backtrack to it
      const pathIndex = r.steps.findIndex((s) => coordEq(s.coord, coord));
      if (pathIndex >= 0 && pathIndex < r.steps.length - 1) {
        const backtracked: RoutingState = {
          ...r,
          steps: r.steps.slice(0, pathIndex + 1),
          currentLayer: r.steps[pathIndex].layer,
        };
        setRouting(backtracked);
        setViewLayer(r.steps[pathIndex].layer);
        return;
      }

      // Must be adjacent to the current head
      if (!isAdjacent(lastStep.coord, coord)) return;

      // Build a temporary occupancy excluding the active route (since routing
      // state is already reflected, we check against committed routes only)
      const occKey: OccupancyKey = `${coord.row},${coord.col},${r.currentLayer}`;
      const committed = buildOccupancy(routes);
      const occupant = committed.get(occKey);
      if (occupant !== undefined && occupant !== r.netId) return;

      // Can't enter a pad of a different net
      const padHere = getPadAt(puzzle.pads, coord);
      if (padHere && padHere.netId !== r.netId) return;

      // Extend
      const newStep: RouteStep = { coord, layer: r.currentLayer };
      const extended: RoutingState = {
        ...r,
        steps: [...r.steps, newStep],
      };
      setRouting(extended);
    },
    [routes, puzzle],
  );

  // ── Right-click to rip up ───────────────────────────────────────────────

  const handleRightClick = useCallback(
    (e: React.MouseEvent, row: number, col: number) => {
      e.preventDefault();
      if (gameState === 'won') return;

      const coord: Coord = { row, col };

      // If currently routing, cancel
      if (routing) {
        setRouting(null);
        return;
      }

      // Find a completed route that passes through this cell
      const route = routes.find(
        (r) => r.complete && r.steps.some((s) => coordEq(s.coord, coord)),
      );
      if (route) {
        setRoutes(routes.filter((r) => r.netId !== route.netId));
      }
    },
    [routing, routes, gameState],
  );

  // ── Keyboard shortcuts ──────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        e.preventDefault();
        toggleLayer();
      }
      if (e.code === 'Escape' && routing) {
        setRouting(null);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [toggleLayer, routing]);

  // ── Render helpers ──────────────────────────────────────────────────────

  const renderCell = (row: number, col: number) => {
    const coord: Coord = { row, col };
    const pad = getPadAt(puzzle.pads, coord);
    const cellKey = `${row},${col}`;
    const traces = cellTraces.get(cellKey) ?? [];

    // Determine if this is the active routing head
    const isRoutingHead =
      routing && coordEq(routing.steps[routing.steps.length - 1].coord, coord);

    // Determine if this cell is in the active path
    const inActivePath =
      routing && routing.steps.some((s) => coordEq(s.coord, coord));

    // Check if any trace here has a via
    const hasVia = traces.some((t) => t.isVia);

    return (
      <button
        key={cellKey}
        className={`
          ${large ? 'w-14 h-14' : 'w-8 h-8'} relative flex items-center justify-center
          transition-colors duration-75
          ${pad ? 'cursor-pointer' : routing ? 'cursor-crosshair' : 'cursor-default'}
          bg-[#1a2332]
          ${isRoutingHead ? 'ring-2 ring-primary ring-inset' : ''}
        `}
        onClick={() => handleCellClick(row, col)}
        onContextMenu={(e) => handleRightClick(e, row, col)}
        onMouseEnter={() => handleCellEnter(row, col)}
      >
        {/* Grid dot */}
        <div className='absolute w-1 h-1 rounded-full bg-default-300/30' />

        {/* Traces */}
        {traces.map((trace, ti) => {
          const colors = NET_COLORS[trace.netId % NET_COLORS.length];
          const isActiveLayer = trace.layer === viewLayer;
          const colorClass = isActiveLayer ? colors.trace : colors.traceback;
          const opacity = isActiveLayer ? '' : 'opacity-30';

          const tw = large ? 'w-1.5' : 'w-1';
          const th = large ? 'h-1.5' : 'h-1';

          return (
            <div key={ti} className={`absolute inset-0 ${opacity}`}>
              {trace.directions.has('top') && (
                <div
                  className={`absolute left-1/2 top-0 h-1/2 ${tw} -translate-x-1/2 ${colorClass}`}
                />
              )}
              {trace.directions.has('bottom') && (
                <div
                  className={`absolute left-1/2 bottom-0 h-1/2 ${tw} -translate-x-1/2 ${colorClass}`}
                />
              )}
              {trace.directions.has('left') && (
                <div
                  className={`absolute top-1/2 left-0 w-1/2 ${th} -translate-y-1/2 ${colorClass}`}
                />
              )}
              {trace.directions.has('right') && (
                <div
                  className={`absolute top-1/2 right-0 w-1/2 ${th} -translate-y-1/2 ${colorClass}`}
                />
              )}
              {/* Center dot for trace intersections and endpoints */}
              {trace.directions.size > 0 && (
                <div
                  className={`absolute left-1/2 top-1/2 ${tw} ${th} -translate-x-1/2 -translate-y-1/2 ${colorClass}`}
                />
              )}
            </div>
          );
        })}

        {/* Via indicator */}
        {hasVia && (
          <div
            className={`absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 ${large ? 'w-5 h-5' : 'w-3 h-3'} rounded-full border-2 border-default-400 bg-default-800 z-10`}
          />
        )}

        {/* Pad */}
        {pad && (
          <div
            className={`
              absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2
              ${large ? 'w-8 h-8' : 'w-5 h-5'} rounded-sm z-20
              ${NET_COLORS[pad.netId % NET_COLORS.length].pad}
              ${inActivePath && routing?.netId === pad.netId ? 'ring-2 ring-white/60' : ''}
              ${routes.some((r) => r.netId === pad.netId && r.complete) ? 'opacity-70' : ''}
            `}
          >
            <div className='absolute inset-[3px] rounded-full bg-[#1a2332]' />
          </div>
        )}
      </button>
    );
  };

  // ── Main render ─────────────────────────────────────────────────────────

  return (
    <div className='flex flex-col items-center gap-2.5 select-none'>
      {/* Difficulty selector */}
      <div className='flex gap-1'>
        {(['easy', 'medium', 'hard'] as Difficulty[]).map((d) => (
          <button
            key={d}
            onClick={() => newPuzzle(d)}
            className={`
              px-2.5 py-0.5 rounded text-xs font-medium capitalize cursor-pointer
              transition-colors
              ${
                difficulty === d
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-default-100 text-default-500 hover:bg-default-200'
              }
            `}
          >
            {d}
          </button>
        ))}
      </div>

      {/* Layer toggle + status */}
      <div className='flex items-center justify-between w-full px-1 text-xs'>
        <div className='flex gap-1'>
          <button
            onClick={() => {
              setViewLayer('front');
              if (routing) setRouting({ ...routing, currentLayer: 'front' });
            }}
            className={`
              px-2 py-0.5 rounded font-medium cursor-pointer transition-colors
              ${
                viewLayer === 'front'
                  ? 'bg-green-600 text-white'
                  : 'bg-default-100 text-default-500 hover:bg-default-200'
              }
            `}
          >
            Front
          </button>
          <button
            onClick={() => {
              setViewLayer('back');
              if (routing) setRouting({ ...routing, currentLayer: 'back' });
            }}
            className={`
              px-2 py-0.5 rounded font-medium cursor-pointer transition-colors
              ${
                viewLayer === 'back'
                  ? 'bg-blue-600 text-white'
                  : 'bg-default-100 text-default-500 hover:bg-default-200'
              }
            `}
          >
            Back
          </button>
        </div>

        <span className='text-default-400'>
          {completedNets}/{netCount} nets
        </span>

        <div className='flex items-center gap-2'>
          <span className='text-default-400'>
            <FontAwesomeIcon icon={faClock} className='mr-1' />
            {formatTime(timer)}
          </span>
          <button
            onClick={gameState === 'won' ? () => newPuzzle() : resetGame}
            className='cursor-pointer hover:scale-110 transition-transform text-default-400'
            title={gameState === 'won' ? 'Next puzzle' : 'Reset'}
          >
            <FontAwesomeIcon
              icon={gameState === 'won' ? faTrophy : faArrowsRotate}
            />
          </button>
        </div>
      </div>

      {/* Board */}
      <div
        ref={boardRef}
        className='grid gap-px bg-[#0d1520] rounded-lg overflow-hidden p-px'
        style={{ gridTemplateColumns: `repeat(${puzzle.cols}, 1fr)` }}
      >
        {Array.from({ length: puzzle.rows }, (_, r) =>
          Array.from({ length: puzzle.cols }, (_, c) => renderCell(r, c)),
        )}
      </div>

      {/* Net legend */}
      <div className='flex gap-2 flex-wrap justify-center'>
        {Array.from({ length: netCount }, (_, i) => {
          const isComplete = routes.some((r) => r.netId === i && r.complete);
          const isActive = routing?.netId === i;
          return (
            <div
              key={i}
              className={`
                flex items-center gap-1 text-xs
                ${isComplete ? 'opacity-40 line-through' : ''}
                ${isActive ? 'font-bold' : ''}
              `}
            >
              <div
                className={`w-2.5 h-2.5 rounded-sm ${NET_COLORS[i % NET_COLORS.length].pad}`}
              />
              <span className={NET_COLORS[i % NET_COLORS.length].text}>
                Net {i}
              </span>
            </div>
          );
        })}
      </div>

      {/* Status text */}
      {gameState === 'won' && (
        <p className='text-sm font-medium text-success'>
          All nets routed in {formatTime(timer)}!
        </p>
      )}
      {gameState === 'won' && (
        <button
          onClick={() => newPuzzle()}
          className='text-xs text-primary hover:underline cursor-pointer'
        >
          Next puzzle
        </button>
      )}
      {gameState !== 'won' && !routing && (
        <div className='flex flex-col items-center gap-1.5'>
          <p className='text-xs text-default-400'>
            Click a pad to start routing. Right-click a trace to rip up.
          </p>
          <button
            onClick={showSolution}
            className='text-xs text-default-400 hover:text-default-600 transition-colors cursor-pointer'
          >
            <FontAwesomeIcon icon={faLightbulb} className='mr-1' />
            Show solution
          </button>
        </div>
      )}
      {routing && (
        <p className='text-xs text-default-400'>
          Routing Net {routing.netId} — move to draw, click to stop. Space to
          switch layers.
        </p>
      )}
    </div>
  );
}
