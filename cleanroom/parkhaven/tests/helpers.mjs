// Test helpers: build a track from a list of piece ids, starting at a cursor.
import { pieceExit, buildCircuit, layoutStats } from '../../../public/apps/parkhaven/js/track.js';

export function buildTrack(start, ids, liftIdx = new Set()) {
  let cur = { ...start, slope: 0, bank: 0 };
  const pieces = [];
  ids.forEach((pid, i) => {
    pieces.push({ pid, x: cur.x, y: cur.y, dir: cur.dir, z: cur.z, lift: liftIdx.has(i) });
    cur = pieceExit(pid, cur);
  });
  return { pieces, end: cur };
}

export const OUT_AND_BACK = [
  'station', 'station', 'station', 'station', 'straight',
  's_0_1', 's_1_2', 's_2_2', 's_2_2', 's_2_1', 's_1_0', 'straight',
  'c_l_R', 'c_l_R',
  's_0_-1', 's_-1_-2', 's_-2_-2', 's_-2_-2', 's_-2_-1', 's_-1_0',
  'straight', 'straight', 'straight', 'straight', 'straight', 'straight',
  'c_l_R', 'c_l_R',
];
export { buildCircuit, layoutStats };

// A looping coaster: lift, 180-degree turn, drop, vertical loop, airtime hill, return.
const lift = ['s_0_1', 's_1_2', 's_2_2', 's_2_1', 's_1_0'];
const drop = ['s_0_-1', 's_-1_-2', 's_-2_-2', 's_-2_-1', 's_-1_0'];
export const LOOPER = {
  ids: ['station', 'station', 'station', 'station', 'straight', ...lift, 'straight', 'c_l_R', 'c_l_R', ...drop,
    'loop_R', 's_0_1', 's_1_0', 's_0_-1', 's_-1_0', 'straight', 'c_s_R', 'straight', 'c_s_R', 'straight', 'straight'],
  lift: new Set([5, 6, 7, 8, 9]),
};
