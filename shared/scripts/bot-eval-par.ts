// Parallel bot-eval: shards games across child tsx processes and aggregates
// the --json outputs. Games are seed-deterministic and independent, so this is
// embarrassingly parallel; results are identical to a sequential run with the
// same base seed (each shard gets a disjoint contiguous seed range).
//
// Usage: pnpm -C shared bot-eval-par -- --teamA v3.1-spatial --teamB v3-mc \
//          --games 24 --seed 9000 [--workers 8] [--mode 2v2]

import { spawn } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

interface Args {
  teamA: string; teamB: string; games: number; seed: number; mode: string; workers: number;
}

function parseArgs(argv: string[]): Args {
  const args: Args = {
    teamA: 'v3.1-spatial', teamB: 'v3-mc', games: 24, seed: 0, mode: '2v2',
    workers: Math.max(1, os.cpus().length - 1),
  };
  for (let i = 0; i < argv.length; i++) {
    const next = () => argv[++i]!;
    if (argv[i] === '--teamA') args.teamA = next();
    else if (argv[i] === '--teamB') args.teamB = next();
    else if (argv[i] === '--games') args.games = parseInt(next(), 10);
    else if (argv[i] === '--seed') args.seed = parseInt(next(), 10);
    else if (argv[i] === '--mode') args.mode = next();
    else if (argv[i] === '--workers') args.workers = parseInt(next(), 10);
  }
  return args;
}

interface ShardResult {
  games: number; aWins: number; bWins: number; draws: number;
  totalTurns: number; totalPiecesA: number; totalPiecesB: number;
  endReasons: Record<string, number>;
}

function runShard(args: Args, seed: number, games: number): Promise<ShardResult> {
  return new Promise((resolve, reject) => {
    const evalScript = path.join(__dirname, 'bot-eval.ts');
    const child = spawn('npx', [
      'tsx', evalScript,
      '--teamA', args.teamA, '--teamB', args.teamB,
      '--games', String(games), '--seed', String(seed),
      '--mode', args.mode, '--json',
    ], { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'inherit'] });
    let out = '';
    child.stdout.on('data', (d) => { out += d; });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code !== 0) return reject(new Error(`shard seed=${seed} exited ${code}`));
      const line = out.trim().split('\n').filter((l) => l.startsWith('{')).pop();
      if (!line) return reject(new Error(`shard seed=${seed}: no JSON output`));
      resolve(JSON.parse(line) as ShardResult);
    });
  });
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const t0 = performance.now();

  // Split games into one shard per worker (contiguous seed ranges).
  const shards: Array<{ seed: number; games: number }> = [];
  const per = Math.floor(args.games / args.workers);
  let remaining = args.games;
  let seed = args.seed;
  for (let w = 0; w < args.workers && remaining > 0; w++) {
    const g = w === args.workers - 1 ? remaining : Math.min(per + (w < args.games % args.workers ? 1 : 0), remaining);
    if (g <= 0) continue;
    shards.push({ seed, games: g });
    seed += g;
    remaining -= g;
  }

  // eslint-disable-next-line no-console
  console.log(`Parallel eval: ${args.teamA} vs ${args.teamB}, ${args.games} games over ${shards.length} workers (base seed ${args.seed})`);

  const results = await Promise.all(shards.map((s) => runShard(args, s.seed, s.games)));

  const agg: ShardResult = {
    games: 0, aWins: 0, bWins: 0, draws: 0,
    totalTurns: 0, totalPiecesA: 0, totalPiecesB: 0, endReasons: {},
  };
  for (const r of results) {
    agg.games += r.games; agg.aWins += r.aWins; agg.bWins += r.bWins; agg.draws += r.draws;
    agg.totalTurns += r.totalTurns; agg.totalPiecesA += r.totalPiecesA; agg.totalPiecesB += r.totalPiecesB;
    for (const [k, v] of Object.entries(r.endReasons)) {
      agg.endReasons[k] = (agg.endReasons[k] ?? 0) + v;
    }
  }

  const dt = (performance.now() - t0) / 1000;
  const pct = (x: number) => `${(x / agg.games * 100).toFixed(1)}%`;
  // eslint-disable-next-line no-console
  console.log('--- Aggregate ---');
  // eslint-disable-next-line no-console
  console.log(`Team A (${args.teamA}) wins: ${agg.aWins} (${pct(agg.aWins)})`);
  // eslint-disable-next-line no-console
  console.log(`Team B (${args.teamB}) wins: ${agg.bWins} (${pct(agg.bWins)})`);
  // eslint-disable-next-line no-console
  console.log(`Draws: ${agg.draws} (${pct(agg.draws)})`);
  // eslint-disable-next-line no-console
  console.log(`Avg turns: ${(agg.totalTurns / agg.games).toFixed(1)} | pieces A/B: ${(agg.totalPiecesA / agg.games).toFixed(1)}/${(agg.totalPiecesB / agg.games).toFixed(1)}`);
  // eslint-disable-next-line no-console
  console.log(`End reasons: ${Object.entries(agg.endReasons).map(([k, v]) => `${k}=${v}`).join(', ')}`);
  // eslint-disable-next-line no-console
  console.log(`Wall time: ${dt.toFixed(0)}s`);
}

void main();
