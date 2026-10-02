// Track geometry, builder transitions and vehicle physics (spec 8.6, 8.7.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { PIECES, pieceExit, pieceFootprint, choosePiece, buildCircuit, simulateTest, stepVehicle, newMeasure, finishMeasure } from '../../../public/apps/parkhaven/js/track.js';
import { buildTrack, LOOPER } from './helpers.mjs';

test('piece exits: curves turn 90 degrees, loops shift one tile sideways', () => {
  const st = { x: 10, y: 10, dir: 0, z: 8, slope: 0, bank: 0 };
  assert.deepEqual(pieceExit('straight', st), { x: 11, y: 10, dir: 0, z: 8, slope: 0, bank: 0 });
  assert.deepEqual(pieceExit('c_s_R', st), { x: 11, y: 12, dir: 1, z: 8, slope: 0, bank: 0 });
  assert.deepEqual(pieceExit('c_l_L', st), { x: 12, y: 7, dir: 3, z: 8, slope: 0, bank: 0 });
  assert.deepEqual(pieceExit('loop_R', st), { x: 13, y: 11, dir: 0, z: 8, slope: 0, bank: 0 });
  assert.equal(pieceExit('s_2_2', st).z, 16);
});

test('footprints: small curve 3 tiles, large curve 5, loop 3x2', () => {
  const st = { x: 10, y: 10, dir: 0, z: 8 };
  assert.equal(pieceFootprint('c_s_R', st).length, 3);
  assert.equal(pieceFootprint('c_l_R', st).length, 5);
  assert.equal(pieceFootprint('loop_R', st).length, 6);
  assert.ok(pieceFootprint('loop_R', st).every((t) => t.z1 >= 20), 'loop reserves its full height');
});

test('the builder steps through transitions toward the requested slope', () => {
  const cur = { x: 0, y: 0, dir: 0, z: 0, slope: 0, bank: 0 };
  assert.equal(choosePiece('coaster', cur, { turn: 0, slope: 2, bank: 0 }).pid, 's_0_1');
  assert.equal(choosePiece('coaster', { ...cur, slope: 1 }, { turn: 0, slope: 2, bank: 0 }).pid, 's_1_2');
  assert.equal(choosePiece('coaster', { ...cur, slope: 2 }, { turn: 0, slope: -1, bank: 0 }).pid, 's_2_1');
  assert.equal(choosePiece('coaster', { ...cur, slope: 1 }, { turn: 1, size: 's', slope: 0, bank: 0 }).pid, 's_1_0');
  assert.equal(choosePiece('coaster', cur, { turn: 1, size: 'l', slope: 0, bank: 1 }).pid, 'b_0_R');
  assert.equal(choosePiece('coaster', { ...cur, bank: 1 }, { turn: 1, size: 'l', slope: 0, bank: 1 }).pid, 'cb_l_R');
  assert.equal(choosePiece('coaster', { ...cur, bank: 1 }, { turn: 0, slope: 0, bank: 0 }).pid, 'b_R_0');
  assert.equal(choosePiece('coaster', cur, { turn: 0, slope: 0, bank: 0, special: 'loop' }).pid, 'loop_R');
  assert.ok(choosePiece('coaster', cur, { turn: 0, slope: 2, bank: 0 }, (grp) => grp === 'base').error, 'locked pieces are refused');
  assert.ok(choosePiece('karts', cur, { turn: 0, slope: 0, bank: 0, special: 'loop' }).error);
  assert.equal(choosePiece('karts', cur, { turn: -1, size: 't', slope: 0, bank: 0 }).pid, 'c_t_L');
});

test('a 30 m drop gives roughly 22 m/s (drag tuning)', () => {
  // straight steep drop of 40 hu (30 m): station, then down steeply, then run out
  const ids = ['station', 'station', 'straight', 's_0_-1', 's_-1_-2', 's_-2_-2', 's_-2_-2', 's_-2_-2', 's_-2_-2', 's_-2_-1', 's_-1_0', 'straight', 'straight'];
  const t = buildTrack({ x: 5, y: 5, dir: 0, z: 60 }, ids);
  const c = buildCircuit(t.pieces);
  const veh = { s: c.stationEnd - 0.3, v: 0, state: 'departing', cars: 1, carLen: 1.8, lapsLeft: 1 };
  const cfg = { kind: 'coaster', liftSpeed: 5, brakeSpeed: 6, stopS: c.stationEnd - 0.3, launch: 0.5 };
  let vmax = 0;
  for (let k = 0; k < 2000 && veh.s < c.total - 5; k++) { stepVehicle(veh, c, cfg, null); vmax = Math.max(vmax, veh.v); }
  const drop = 60 - t.pieces[t.pieces.length - 1].z; // hu
  assert.equal(drop, 42);
  assert.ok(vmax > 20 && vmax < 25, `vmax ${vmax.toFixed(1)} m/s`);
});

test('a full looping circuit completes its test run and is measured', () => {
  const t = buildTrack({ x: 10, y: 10, dir: 0, z: 4 }, LOOPER.ids, LOOPER.lift);
  assert.deepEqual([t.end.x, t.end.y, t.end.dir, t.end.z], [10, 10, 0, 4], 'circuit closes');
  const c = buildCircuit(t.pieces);
  assert.ok(c && c.stationPieces === 4);
  const r = simulateTest(c, { kind: 'coaster', liftSpeed: 5, brakeSpeed: 6, stopS: c.stationEnd - 0.3, launch: 2, cars: 4, carLen: 1.8 });
  assert.ok(r.ok, r.reason);
  assert.ok(r.stats.Smax > 12 && r.stats.Smax < 22);
  assert.ok(r.stats.Gneg < 0, 'the airtime hill makes riders float');
  assert.ok(r.stats.airtime > 0);
  assert.ok(r.stats.H >= 14);
});

test('a train without a lift stalls and fails its test', () => {
  const ids = ['station', 'station', 'straight', 's_0_1', 's_1_1', 's_1_1', 's_1_0', 'c_l_R', 'c_l_R', 's_0_-1', 's_-1_-1', 's_-1_-1', 's_-1_0', 'straight', 'straight', 'straight', 'straight', 'straight', 'c_l_R', 'c_l_R'];
  const t = buildTrack({ x: 10, y: 10, dir: 0, z: 4 }, ids);
  const c = buildCircuit(t.pieces);
  const r = simulateTest(c, { kind: 'coaster', liftSpeed: 5, brakeSpeed: 6, stopS: c.stationEnd - 0.3, launch: 2, cars: 2, carLen: 1.8 });
  assert.equal(r.ok, false);
});

test('circuits need exactly one block of station pieces', () => {
  const t = buildTrack({ x: 10, y: 10, dir: 0, z: 4 }, ['straight', 'straight', 'c_s_R', 'c_s_R', 'straight', 'straight', 'c_s_R', 'c_s_R']);
  assert.equal(buildCircuit(t.pieces), null);
});

test('every piece in the table has consistent geometry', () => {
  for (const [id, P] of Object.entries(PIECES)) {
    const g0 = P.geom(0), g1 = P.geom(1);
    assert.ok(Math.abs(g0.x) < 1e-9 && Math.abs(g0.y) < 1e-9 && Math.abs(g0.z) < 1e-9, id);
    assert.ok(Math.abs(g1.z - P.dz) < 1e-6, `${id} dz`);
    // the exit point is the middle of an edge of the next tile
    const [a, b] = P.out;
    const turn = P.dirChange || 0;
    const ex = turn ? [a + 0.5, b - turn * 0.5] : [a, b];
    assert.ok(Math.abs(g1.x - ex[0]) < 1e-6 && Math.abs(g1.y - ex[1]) < 1e-6, `${id} exit (${g1.x},${g1.y}) vs ${ex}`);
  }
});
